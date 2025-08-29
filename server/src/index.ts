import express, {Express, Request, Response} from 'express';
import dotenv from 'dotenv';
import {mineruPipeline} from "./mineru";
import {pandocPipeline, isSupportedFormat, getSupportedExtensions, getSupportedMimeTypes} from "./pandoc";
import axios from 'axios';
import {randomUUID} from "node:crypto";
import {minioClient} from "./minio_upload";
import multer from 'multer';
import crypto from 'crypto';

import cors from 'cors';
import path from "path";
import {getJobProgress, JobStatus, setJobProgress} from "./jobStatus";
import {beamSearchMain, enhancedSearch, SearchOptions} from "./beamSearchService";
import { SearchAgentExecutor } from "./searchAgentExecutor";
import {
    AgentCard,
    TaskStore,
    InMemoryTaskStore,
    DefaultRequestHandler,
} from '@a2a-js/sdk/server';
import { A2AExpressApp } from '@a2a-js/sdk/server/express';

let FRONTEND_DIR = process.env.FRONTEND_DIR
if (!FRONTEND_DIR) {
    // Check if dist directory exists, otherwise fallback to frontend root
    const distPath = path.join(__dirname, "../../frontend/dist")
    const frontendPath = path.join(__dirname, "../../frontend")
    
    if (require('fs').existsSync(distPath)) {
        FRONTEND_DIR = distPath
    } else {
        FRONTEND_DIR = frontendPath
        console.warn('Frontend dist directory not found, using frontend root directory')
    }
}

dotenv.config();

const app: Express = express();
const port = 8081;

app.use(express.json({limit: '50mb'}));
app.use(express.urlencoded({limit: '50mb'}));

app.listen(port, () => {
    console.log(`⚡️[server]: Server is running at http://localhost:${port}`);
    console.log(`[A2A] A2A protocol support initialized successfully`);
});


app.use(express.json());

// A2A Protocol: Agent Card definition
const superReaderAgentCard: AgentCard = {
    name: "SuperReader Knowledge Search Agent",
    description: "Advanced knowledge search agent that can search through document trees and provide intelligent answers with references using beam search and GPT-4o-mini",
    version: "1.0.0",
    url: `http://localhost:${port}/`, // Will be dynamically updated
    protocolVersion: "0.3.0",
    capabilities: {
        streaming: false,
        pushNotifications: false,
        stateTransitionHistory: true,
    },
    defaultInputModes: ["text"],
    defaultOutputModes: ["text", "task-status"],
    skills: [
        {
            id: "search_knowledge_tree",
            name: "Search Knowledge Tree", 
            description: "Search through a document knowledge tree to find relevant information and generate comprehensive answers with clickable references. Requires a tree URL with ID parameter in the message.",
            tags: ["search", "knowledge tree", "AI search", "document analysis"],
            examples: [
                "What is the main methodology? tree: http://localhost:29999/?id=abc123",
                "Summarize the key findings located at http://localhost:29999/?id=xyz789", 
                "Find relevant sections about machine learning url: http://treer.ai/?id=def456",
                "Give me an overview of http://localhost:29999/?id=ghi789",
                "Summary of the tree with id 3b37b95c-97c7-49cd-89e9-5e103f28f31b",
                "Analyze content from tree id abc123-def4-5678-90ab-cdef12345678"
            ],
            inputModes: ["text"],
            outputModes: ["text", "task-status"]
        }
    ],
    supportsAuthenticatedExtendedCard: false,
};

// Initialize A2A routes BEFORE static file routes to avoid conflicts
async function setupA2ARoutes() {
    // Update the agent card with the actual URL
    superReaderAgentCard.url = `http://localhost:${port}/`;

    // Create TaskStore
    const taskStore: TaskStore = new InMemoryTaskStore();

    // Create AgentExecutor
    const agentExecutor = new SearchAgentExecutor();

    // Create DefaultRequestHandler
    const requestHandler = new DefaultRequestHandler(
        superReaderAgentCard,
        taskStore,
        agentExecutor
    );

    // Create and setup A2AExpressApp
    const a2aAppBuilder = new A2AExpressApp(requestHandler);
    
    // Setup A2A routes on the existing express app (using default agent-card.json path)
    a2aAppBuilder.setupRoutes(app);
    
    // Also setup agent.json endpoint for compatibility
    app.get('/.well-known/agent.json', async (req, res) => {
        try {
            const agentCard = await requestHandler.getAgentCard();
            res.json(agentCard);
        } catch (error) {
            console.error("Error fetching agent card:", error);
            res.status(500).json({ error: "Failed to retrieve agent card" });
        }
    });

    console.log(`[A2A] SuperReader agent initialized with URL: ${superReaderAgentCard.url}`);
    console.log(`[A2A] Agent Card available at:`);
    console.log(`  - http://localhost:${port}/.well-known/agent-card.json`);
    console.log(`  - http://localhost:${port}/.well-known/agent.json`);
}

// Setup A2A routes before static routes
setupA2ARoutes();

app.use(express.static(FRONTEND_DIR));
app.get('/wait', (_req, res) => {
    res.sendFile(path.join(FRONTEND_DIR, "index.html"));
});
app.get('/upload', (_req, res) => {
    res.sendFile(path.join(FRONTEND_DIR, "index.html"));
});
app.get('/searcher', (_req, res) => {
    res.sendFile(path.join(FRONTEND_DIR, "index.html"));
});


// Get supported document formats
app.get('/supported_formats', (_req, res) => {
    res.json({
        extensions: getSupportedExtensions(),
        mimeTypes: getSupportedMimeTypes(),
        formats: {
            pdf: ['application/pdf'],
            documents: getSupportedMimeTypes()
        }
    });
});

app.use(cors({
    origin: ['http://localhost:5173', "http://localhost:7777", "http://localhost:39999", "https://treer.ai"], // Allow your frontend origin
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

// New universal document upload endpoint
app.post('/upload_document', upload.single('file'), async (req: Request & { file?: Express.Multer.File }, res: Response) => {
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
        
    } catch (error) {
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
app.post('/submit/document_to_tree', async (req: Request, res: Response) => {
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

    res.json({status: 'success', message: 'Document processing started', job_id: job_id});
});

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

app.post('/search_and_answer', async (req: Request, res: Response) => {
    const question = req.body.question;
    const treeUrl = req.body.treeUrl;


    try {
        const url = new URL(treeUrl);
        const treeId = url.searchParams.get('id');
        let host = `${url.protocol}//${url.hostname}`;
        if (url.port) {
            host += `:${url.port}`;
        }

        if (!treeId) {
            throw new Error('Missing id parameter in URL');
        }

        if (url.hostname !== 'treer.ai' && url.hostname !== 'localhost') {
            throw new Error('Invalid host');
        }
        console.log(question, treeId, host)
        const answer = await beamSearchMain(question, treeId, host);

        res.json({
            answer: answer
        });

    } catch (error) {
        res.status(400).json({
            error: 'Invalid URL format or missing required parameters'
        });
        return;
    }
});

// Note: A2A protocol endpoints are now handled by the A2A SDK
// The SDK automatically provides:
// - /.well-known/agent.json (Agent Card)
// - /a2a/* (A2A protocol endpoints)
// - Task management and status tracking

// Keep legacy discovery endpoint for backward compatibility
app.get('/a2a/discover', async (_req, res) => {
    res.json({
        compatible_agents: [
            {
                name: "Document Processing Agent",
                description: "Processes various document formats into knowledge trees",
                capabilities: ["document_to_tree", "pdf_to_tree"],
                endpoint: "/submit/document_to_tree"
            }
        ],
        collaboration_patterns: [
            {
                pattern: "search_then_process", 
                description: "Search for relevant documents, then process them into knowledge trees for deeper analysis"
            },
            {
                pattern: "multi_tree_search",
                description: "Search across multiple knowledge trees and combine results"
            }
        ],
        supported_protocols: ["A2A", "HTTP/REST"],
        agent_info: {
            name: "SuperReader Knowledge Search Agent",
            version: "1.0.0",
            specialization: "Knowledge tree search and intelligent answer generation",
            performance: {
                avg_response_time_ms: 2500,
                supported_languages: ["English", "Chinese", "Multi-language"],
                max_concurrent_requests: 10
            }
        }
    });
});