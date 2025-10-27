import { Router, Request, Response } from 'express';
import multer from 'multer';
import crypto from 'crypto';
import path from 'path';
import axios from 'axios';
import { randomUUID } from 'node:crypto';
import { minioClient } from '../minio_upload';
import { mineruPipeline } from '../mineru';
import { pandocPipeline, isSupportedFormat, getSupportedExtensions, getSupportedMimeTypes } from '../pandoc';
import { getJobProgress, JobStatus, setJobProgress } from '../jobStatus';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// Get supported document formats
router.get('/supported_formats', (_req, res) => {
    res.json({
        extensions: getSupportedExtensions(),
        mimeTypes: getSupportedMimeTypes(),
        formats: {
            pdf: ['application/pdf'],
            documents: getSupportedMimeTypes()
        }
    });
});

// Upload PDF endpoint
router.post('/upload_pdf', upload.single('file'), async (req: Request & { file?: Express.Multer.File }, res: Response) => {
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

// Universal document upload endpoint
router.post('/upload_document', upload.single('file'), async (req: Request & { file?: Express.Multer.File }, res: Response) => {
    try {
        console.log('=== /upload_document endpoint called ===');
        console.log('Request file:', req.file ? 'Present' : 'Missing');

        if (!req.file) {
            console.log('Error: No file uploaded');
            res.status(400).send('No file uploaded');
            return;
        }

        const filename = req.file.originalname;
        const mimeType = req.file.mimetype;

        console.log('File details:', {
            filename,
            mimeType,
            size: req.file.buffer.length
        });

        // Check if it's a PDF (use existing PDF pipeline)
        const isPdf = mimeType === 'application/pdf' && filename.toLowerCase().endsWith('.pdf');

        // Check if it's a supported document format
        console.log('Checking if supported format...');
        const isSupportedDoc = isSupportedFormat(filename, mimeType);
        console.log('Format check results:', { isPdf, isSupportedDoc });

        if (!isPdf && !isSupportedDoc) {
            const supportedExts = getSupportedExtensions();
            console.log('File format not supported. Supported extensions:', supportedExts);
            res.status(400).json({
                status: 'error',
                message: `Unsupported file format. Supported formats: PDF, ${supportedExts.join(', ')}`
            });
            return;
        }

        // Calculate SHA-256 hash of the file
        console.log('Calculating file hash...');
        const hash = crypto.createHash('sha256');
        hash.update(req.file.buffer);
        const fileExtension = path.extname(filename);
        const objectName = hash.digest('hex') + fileExtension;
        console.log('Generated object name:', objectName);

        // Determine bucket based on file type
        const bucketName = isPdf ? "pdf" : "documents";
        console.log('Target bucket:', bucketName);

        console.log('Uploading to MinIO...');
        console.log('MinIO config:', {
            host: process.env.MINIO_PUBLIC_HOST,
            bucket: bucketName
        });

        // Ensure bucket exists
        console.log('Checking if bucket exists...');
        const bucketExists = await minioClient.bucketExists(bucketName);
        if (!bucketExists) {
            console.log(`Creating bucket: ${bucketName}`);
            await minioClient.makeBucket(bucketName);
            console.log(`Bucket ${bucketName} created successfully`);
        }

        // Upload with public read metadata
        await minioClient.putObject(bucketName, objectName, req.file.buffer, req.file.buffer.length, {
            'Content-Type': mimeType,
            'Cache-Control': 'public, max-age=86400'
        });
        console.log('File uploaded successfully to MinIO');

        // Return the MinIO URL - server will use MinIO client to download
        const fileUrl = `${process.env.MINIO_PUBLIC_HOST}/${bucketName}/${objectName}`;

        const responseData = {
            status: 'success',
            url: fileUrl,
            file_type: isPdf ? 'pdf' : 'document',
            original_filename: filename
        };

        console.log('Returning response:', responseData);
        res.json(responseData);

    } catch (error: any) {
        console.error('=== ERROR in /upload_document ===');
        console.error('Error type:', error.constructor.name);
        console.error('Error message:', error.message);
        console.error('Error stack:', error.stack);

        res.status(500).json({
            status: 'error',
            message: 'Failed to upload file: ' + error.message
        });
    }
});

// Helper functions for processing
async function processPdfToTree(file_url: string, job_id: string, userid?: string) {
    try {
        const result = await mineruPipeline(file_url, job_id);
        try {

            await setJobProgress(job_id, {
                status: JobStatus.PROCESSING,
                message: "Generating the tree",
            });

            const requestBody: any = {
                html_source: result,
                file_url: file_url
            };

            if (userid) {
                requestBody.userid = userid;
            }

            const res = await axios.post('http://localhost:8080/generate_from_html', requestBody);

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

async function processDocumentToTree(file_url: string, job_id: string, original_filename: string, userid?: string) {
    try {
        const result = await pandocPipeline(file_url, job_id, original_filename);
        try {

            await setJobProgress(job_id, {
                status: JobStatus.PROCESSING,
                message: "Generating the tree",
            });

            const requestBody: any = {
                html_source: result,
                file_url: file_url
            };

            if (userid) {
                requestBody.userid = userid;
            }

            const res = await axios.post('http://localhost:8080/generate_from_html', requestBody);

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

// Universal document processing endpoint
router.post('/submit/document_to_tree', async (req: Request, res: Response) => {
    const file_url = req.body.file_url;
    const file_type = req.body.file_type; // 'pdf' or 'document'
    const original_filename = req.body.original_filename;
    const userid = req.body.userid; // Optional user ID for tree ownership

    if (!file_url) {
        res.status(400).json({
            status: 'error',
            message: 'Missing file_url parameter'
        });
        return;
    }

    if (!file_type) {
        res.status(400).json({
            status: 'error',
            message: 'Missing file_type parameter'
        });
        return;
    }

    const job_id = randomUUID();
    await setJobProgress(job_id, {
        status: JobStatus.PROCESSING,
        message: "Processing started",
    });

    // Route to appropriate processing pipeline
    if (file_type === 'pdf') {
        processPdfToTree(file_url, job_id, userid);
    } else if (file_type === 'document') {
        if (!original_filename) {
            res.status(400).json({
                status: 'error',
                message: 'Missing original_filename parameter for document processing'
            });
            return;
        }
        processDocumentToTree(file_url, job_id, original_filename, userid);
    } else {
        res.status(400).json({
            status: 'error',
            message: 'Invalid file_type. Must be "pdf" or "document"'
        });
        return;
    }

    res.json({ status: 'success', message: 'Document processing started', job_id: job_id });
});

// Legacy PDF processing endpoint
router.post('/submit/pdf_to_tree', async (req: Request, res: Response) => {
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
    res.json({ status: 'success', message: 'PDF processing started', job_id: job_id });
});

// Nature paper processing endpoint
router.post('/submit/nature_to_tree', async (req: Request, res: Response) => {
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
    res.json({ status: 'success', message: 'Nature paper processing started', job_id: job_id });
});

// Get processing result/status
router.post('/result', async (req: Request, res: Response) => {
    const job_id = req.body.job_id;
    const status = await getJobProgress(job_id)
    if (!status) {
        res.status(404).json({ status: 'error' });
        return;
    }
    res.json(status)
});

export default router;
