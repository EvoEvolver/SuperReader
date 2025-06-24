import express, {Express, Request, Response} from 'express';
import dotenv from 'dotenv';
import {mineruPipeline} from "./mineru";
import axios from 'axios';
import {randomUUID} from "node:crypto";
import {minioClient} from "./minio_upload";
import multer from 'multer';
import crypto from 'crypto';

import cors from 'cors';
import path from "path";
import {getJobProgress, JobStatus, setJobProgress} from "./jobStatus";

let FRONTEND_DIR = process.env.FRONTEND_DIR
if (!FRONTEND_DIR) {
    FRONTEND_DIR = path.join(__dirname, "../../frontend/dist")
}

dotenv.config();

const app: Express = express();
const port = 8081;

app.use(express.json({limit: '50mb'}));
app.use(express.urlencoded({limit: '50mb'}));

app.listen(port, () => {
    console.log(`⚡️[server]: Server is running at http://localhost:${port}`);
});


app.use(express.json());

app.use(express.static(FRONTEND_DIR));
app.get('/wait', (_req, res) => {
    res.sendFile(path.join(FRONTEND_DIR, "index.html"));
});

app.use(cors({
    origin: 'http://localhost:5173', // Allow your frontend origin
    methods: ['GET', 'POST'], // Allowed methods
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true // Enable credentials (cookies, authorization headers, etc)
}));

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
            url: `${process.env.MINIO_PUBLIC_HOST}/${bucketName}/${objectName}`
        });
    } catch (error) {
        console.error('Error uploading to Minio:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to upload file'
        });
    }
});


async function processPdfToTree(file_url: string, job_id: string) {
    try {
        const result = await mineruPipeline(file_url, job_id);
        try {

            await setJobProgress(job_id, {
                status: JobStatus.PROCESSING,
                message: "Generating the tree",
            });

            const res = await axios.post('http://localhost:8080/generate_from_html', {
                html_source: result,
                file_url: file_url
            });

            const tree_url = res.data["tree_url"];

            await setJobProgress(job_id, {
                status: JobStatus.COMPLETE,
                message: "Finished",
                treeUrl: tree_url
            });
        } catch (error) {
            await setJobProgress(job_id, {
                status: JobStatus.ERROR,
                message: "Generate request failed:" + error.toString(),
            });
            console.error("Generate request failed:", error);
        }
    } catch (e) {
        await setJobProgress(job_id, {
            status: JobStatus.FAILED,
            message: "Pipeline failed:" + e.toString(),
        });
        console.error("Pipeline failed:", e);
    }
}

// In your route handler:
app.post('/submit/pdf_to_tree', async (req: Request, res: Response) => {
    const file_url = req.body.file_url;
    if (!file_url) {
        res.status(400).json({
            status: 'error',
            message: 'Missing file_url parameter'
        });
        return;
    }
    const job_id = randomUUID();
    await setJobProgress(job_id, {
        status: JobStatus.PROCESSING,
        message: "Processing started",
    });

    // Start async processing
    processPdfToTree(file_url, job_id);

    // Send immediate response
    res.json({status: 'success', message: 'PDF processing started', job_id: job_id});
});

app.post('/submit/nature_to_tree', async (req: Request, res: Response) => {
    const html_source = req.body.html_source
    const paper_url = req.body.paper_url
    const job_id = randomUUID()
    await setJobProgress(job_id, {
        status: JobStatus.PROCESSING,
        message: "Processing"
    })

    axios.post('http://localhost:8080/generate_from_nature', {
        paper_url: paper_url,
        html_source: html_source
    }).then(async (res) => {
        const tree_url = res.data["tree_url"]
        await setJobProgress(job_id, {
            status: JobStatus.COMPLETE,
            message: "Finished",
            treeUrl: tree_url
        })
    }).catch(async (error) => {
        await setJobProgress(job_id, {
            status: JobStatus.ERROR,
            message: "Generate request failed:" + error.toString(),
        })
        console.error("Generate request failed:", error);
    });
    res.json({status: 'success', message: 'Nature paper processing started', job_id: job_id});
});

app.post('/result', async (req: Request, res: Response) => {
    const job_id = req.body.job_id;
    const status = await getJobProgress(job_id)
    if (!status) {
        res.status(404).json({status: 'error'});
        return;
    }
    res.json(status)
});

