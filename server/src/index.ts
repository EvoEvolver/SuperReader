import express, {Express, Request, Response} from 'express';
import dotenv from 'dotenv';
import {mineruPipeline} from "./mineru";
import axios from 'axios';
import {randomUUID} from "node:crypto";
import {createClient} from "redis";
import {minioClient} from "./minio_upload";
import multer from 'multer';
import crypto from 'crypto';


dotenv.config();

const app: Express = express();
const port = 8081;
const redis = createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379'
});
redis.connect();

app.use(express.json({limit: '50mb'}));
app.use(express.urlencoded({limit: '50mb'}));

app.listen(port, () => {
    console.log(`⚡️[server]: Server is running at http://localhost:${port}`);
});

enum JobStatus {
    PROCESSING = "processing",
    COMPLETE = "complete",
    ERROR = "error",
    FAILED = "failed"
}

const job_status: Map<string, JobStatus> = new Map()

app.use(express.json());

// Multer for handling file uploads
const upload = multer({storage: multer.memoryStorage()});


app.post('/upload_pdf', upload.single('file'), async (req: Request & { file?: Express.Multer.File }, res: Response) => {
    if (!req.file) {
        res.status(400).send('No file uploaded');
        return;
    }
    // Check MIME type and extension
    const isPdf = req.file.mimetype === 'application/pdf' && req.file.originalname.toLowerCase().endsWith('.pdf');
    if (!isPdf) {
        res.status(400).send('Only PDF files are allowed');
        return;
    }
    // Calculate SHA-256 hash of the file
    const hash = crypto.createHash('sha256');
    hash.update(req.file.buffer);
    const objectName = hash.digest('hex') + ".pdf"

    const bucketName = "pdf"

    try {
        await minioClient.putObject(bucketName, objectName, req.file.buffer);
        res.json({
            status: 'success',
            url: `${process.env.MINIO_ENDPOINT}/${bucketName}/${objectName}`
        });
    } catch (error) {
        console.error('Error uploading to Minio:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to upload file'
        });
    }
});


app.post('/submit/pdf_to_tree', (req: Request, res: Response) => {
    const file_url = req.body.file_url
    if (!file_url){
        res.status(400).json({
            status: 'error',
            message: 'Missing file_url parameter'
        });
        return;
    }
    const job_id = randomUUID()
    job_status[job_id] = JobStatus.PROCESSING

    // Send response immediately after initializing the job
    res.json({status: 'success', message: 'PDF processing started', job_id: job_id});

    // Continue with async processing after sending response
    mineruPipeline(file_url).then((result) => {
        axios.post('http://localhost:8080/generate_from_html', {
            html_source: result
        }).then(async (res) => {
            const tree_url = res.data["tree_url"]
            await redis.set("tree_url_for_job_" + job_id, tree_url)
            job_status[job_id] = JobStatus.COMPLETE;
        }).catch((error) => {
            job_status[job_id] = JobStatus.ERROR;
            console.error("Generate request failed:", error);
        });
    }).catch((e) => {
        job_status[job_id] = JobStatus.FAILED;
        console.error("Pipeline failed:", e);
    });
});

app.post('/submit/nature_to_tree', (req: Request, res: Response) => {
    const html_source = req.body.html_source
    const paper_url = req.body.paper_url
    const job_id = randomUUID()
    job_status[job_id] = JobStatus.PROCESSING
    axios.post('http://localhost:8080/generate_from_nature', {
        paper_url: paper_url,
        html_source: html_source
    }).then(async (res) => {
        const tree_url = res.data["tree_url"]
        await redis.set("tree_url_for_job_" + job_id, tree_url)
        job_status[job_id] = JobStatus.COMPLETE;
    }).catch((error) => {
        job_status[job_id] = JobStatus.ERROR;
        console.error("Generate request failed:", error);
    });
    // Add response
    res.json({status: 'success', message: 'Nature paper processing started', job_id: job_id});
});

app.post('/result', async (req: Request, res: Response) => {
    const job_id = req.body.job_id;
    const status = job_status[job_id];
    if (!status) {
        res.status(404).json({status: 'error'});
        return;
    }
    if (status === JobStatus.PROCESSING) {
        res.json({status: 'processing', message: 'Still processing'});
        return;
    }
    if (status === JobStatus.ERROR) {
        res.json({status: 'error', message: 'Error in processing'});
        return;
    }
    if (status === JobStatus.COMPLETE) {
        const tree_url = await redis.get("tree_url_for_job_" + job_id);
        res.json({status: 'success', tree_url: tree_url});
        return;
    }
    // Handle unhandled statuses (e.g., FAILED)
    res.status(500).json({status: 'error', message: 'Unknown or failed job status'});
});

