import {Request, Response, Router} from 'express';
import {beamSearchMain, beamSearchWithEvents} from '../beamSearchService';
import {agenticSearchWithEvents} from '../agenticSearchByTree/agenticSearchService';

const router = Router();

/**
 * Search and answer endpoint
 * POST /search_and_answer
 */
router.post('/search_and_answer', async (req: Request, res: Response) => {
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

/**
 * Search and answer endpoint with SSE for intermediate results
 * GET /search_and_answer_stream
 */
router.get('/search_and_answer_stream', async (req: Request, res: Response) => {
    const question = req.query.question as string;
    const treeUrl = req.query.treeUrl as string;

    if (!question || !treeUrl) {
        res.status(400).json({
            error: 'Missing question or treeUrl parameter'
        });
        return;
    }

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

        // Set headers for SSE
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('Access-Control-Allow-Origin', '*');

        console.log(question, treeId, host);

        // Event emitter function
        const sendEvent = (event: string, data: any) => {
            res.write(`event: ${event}\n`);
            res.write(`data: ${JSON.stringify(data)}\n\n`);
        };

        // Start the search with event callbacks
        await beamSearchWithEvents(question, treeId, host, sendEvent);

        // Send completion event
        sendEvent('complete', { message: 'Search completed' });
        res.end();

    } catch (error) {
        res.write(`event: error\n`);
        res.write(`data: ${JSON.stringify({ error: 'Invalid URL format or missing required parameters' })}\n\n`);
        res.end();
    }
});

/**
 * Agentic search endpoint with SSE for intermediate results
 * GET /agentic_search_stream
 */
router.get('/agentic_search_stream', async (req: Request, res: Response) => {
    const question = req.query.question as string;
    const treeUrl = req.query.treeUrl as string;

    if (!question || !treeUrl) {
        res.status(400).json({
            error: 'Missing question or treeUrl parameter'
        });
        return;
    }

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

        // Set headers for SSE
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('Access-Control-Allow-Origin', '*');

        console.log('[agentic_search_stream]', question, treeId, host);

        // Event emitter function
        const sendEvent = (event: string, data: any) => {
            res.write(`event: ${event}\n`);
            res.write(`data: ${JSON.stringify(data)}\n\n`);
        };

        // Start the agentic search with event callbacks
        await agenticSearchWithEvents(question, treeId, host, sendEvent);

        // Send completion event
        sendEvent('complete', { message: 'Search completed' });
        res.end();

    } catch (error) {
        res.write(`event: error\n`);
        res.write(`data: ${JSON.stringify({ error: 'Invalid URL format or missing required parameters' })}\n\n`);
        res.end();
    }
});


export default router;
