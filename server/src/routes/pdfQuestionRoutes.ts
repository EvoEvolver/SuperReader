import {Request, Response, Router} from 'express';
import {mineruSelfHostedPipeline} from '../mineru_selfhosted';
import {agenticReaderWithEvents} from '../agenticSearchByPosition/agenticReader';
import {v4 as uuidv4} from 'uuid';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

const router = Router();

// Configure multer for PDF upload
const upload = multer({
    dest: 'uploads/',
    limits: {
        fileSize: 50 * 1024 * 1024 // 50MB limit
    },
    fileFilter: (_req, file, cb) => {
        if (file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Only PDF files are allowed'));
        }
    }
});

/**
 * PDF Question Answering Endpoint with SSE
 * POST /pdf_question_stream
 *
 * This endpoint combines MinerU PDF parsing with agentic reading to answer questions about PDFs.
 *
 * Request:
 * - Content-Type: multipart/form-data
 * - Fields:
 *   - file: PDF file (required)
 *   - question: Question about the PDF (required)
 *   - max_iterations: Maximum iterations for agent (optional, default: 20)
 *   - model: OpenAI model to use (optional, default: 'gpt-4o-mini')
 *   - parse_formula: Parse mathematical formulas (optional, default: true)
 *   - parse_table: Parse tables (optional, default: true)
 *   - parse_ocr: Use OCR for scanned PDFs (optional, default: true)
 *
 * Response: Server-Sent Events (SSE) stream with the following event types:
 * - status: Processing status updates
 * - answer: Final answer from the agent
 * - metadata: Processing metadata (timing, stats)
 * - complete: Processing completed
 * - error: Error occurred
 */
router.post('/pdf_question_stream', upload.single('file'), async (req: Request, res: Response) => {
    const jobId = uuidv4();

    try {
        // Validate inputs
        if (!req.file) {
            res.status(400).json({error: 'No PDF file provided'});
            return;
        }

        const question = req.body.question;
        if (!question) {
            // Clean up uploaded file
            fs.unlinkSync(req.file.path);
            res.status(400).json({error: 'No question provided'});
            return;
        }

        // Parse options
        const maxIterations = parseInt(req.body.max_iterations) || 20;
        const model = req.body.model || 'gpt-4o-mini';
        const parseFormula = req.body.parse_formula !== 'false';
        const parseTable = req.body.parse_table !== 'false';
        const parseOcr = req.body.parse_ocr !== 'false';

        // Set up SSE
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('Access-Control-Allow-Origin', '*');

        const sendEvent = (event: string, data: any) => {
            res.write(`event: ${event}\n`);
            res.write(`data: ${JSON.stringify(data)}\n\n`);
        };

        console.log(`[pdf_question_stream] Job ${jobId}: Processing PDF ${req.file.originalname}`);
        console.log(`[pdf_question_stream] Question: "${question}"`);
        console.log(`[pdf_question_stream] Options: iterations=${maxIterations}, model=${model}`);

        sendEvent('status', {
            stage: 'pdf_parsing',
            message: 'Starting PDF parsing with MinerU...',
            jobId
        });

        // Step 1: Parse PDF to markdown using MinerU
        const markdownContent = await mineruSelfHostedPipeline(
            req.file.path,
            jobId,
            {
                parseFormula,
                parseTable,
                parseOcr
            },
            true // Return markdown instead of HTML
        );

        sendEvent('status', {
            stage: 'pdf_parsed',
            message: `PDF parsed successfully (${markdownContent.length} characters)`,
            documentLength: markdownContent.length
        });

        // Step 2: Use agentic reader to answer the question
        await agenticReaderWithEvents(
            question,
            markdownContent,
            sendEvent,
            {
                max_iterations: maxIterations,
                model,
                include_metadata: true
            }
        );

        // Clean up the uploaded file
        try {
            fs.unlinkSync(req.file.path);
        } catch (error) {
            console.warn(`[pdf_question_stream] Failed to delete uploaded file: ${error}`);
        }

        console.log(`[pdf_question_stream] Job ${jobId}: Completed successfully`);
        res.end();

    } catch (error: any) {
        console.error(`[pdf_question_stream] Job ${jobId}: Error:`, error);

        // Try to send error event if headers not sent
        if (!res.headersSent) {
            res.status(500).json({
                error: error.message || 'An error occurred while processing the PDF'
            });
        } else {
            res.write(`event: error\n`);
            res.write(`data: ${JSON.stringify({
                message: error.message || 'An error occurred while processing the PDF'
            })}\n\n`);
            res.end();
        }

        // Clean up uploaded file on error
        if (req.file) {
            try {
                fs.unlinkSync(req.file.path);
            } catch (cleanupError) {
                console.warn(`[pdf_question_stream] Failed to delete uploaded file: ${cleanupError}`);
            }
        }
    }
});

export default router;
