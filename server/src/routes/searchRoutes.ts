import { Router, Request, Response } from 'express';
import { beamSearchMain } from '../beamSearchService';

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
 * Legacy A2A discovery endpoint
 * GET /a2a/discover
 */
router.get('/a2a/discover', async (_req, res) => {
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

export default router;
