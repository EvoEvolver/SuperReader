import { Router, Request, Response } from 'express';
import { AgentRegistry } from '../agentRegistry';
import { SimpleAgentInterface } from '../simpleAgentInterface';

const router = Router();

// Function to initialize routes with agent registry
export function createPaperAgentRoutes(agentRegistry: AgentRegistry): Router {

    /**
     * Register a new paper agent for a specific tree ID
     * POST /paper-agents/register
     */
    router.post('/register', async (req: Request, res: Response): Promise<void> => {
        try {
            const { treeId, paperTitle, host, maxNodes, iconUrl } = req.body;

            if (!treeId) {
                res.status(400).json({
                    error: 'Missing required parameter: treeId'
                });
                return;
            }

            console.log(`[API] Registering paper agent for tree: ${treeId}`);

            // Check if agent already exists
            const existingAgent = agentRegistry.getAgent(treeId);
            if (existingAgent) {
                const existingAgentInfo = agentRegistry.getAgentInfo(treeId);
                res.json({
                    message: 'Agent already exists for this paper',
                    agent_url: existingAgent.getAgentUrl(),
                    agent_card: existingAgent.getAgentCard(),
                    tree_id: treeId,
                    paper_title: existingAgentInfo?.config.paperTitle || 'Unknown',
                    created_at: existingAgentInfo?.createdAt.toISOString(),
                    status: 'existing'
                });
                return;
            }

            // Register new agent
            const agent = await agentRegistry.registerPaperAgent(treeId, {
                paperTitle,
                host,
                maxNodes,
                iconUrl
            });

            res.json({
                message: 'Paper agent registered successfully',
                agent_url: agent.getAgentUrl(),
                agent_card: agent.getAgentCard(),
                tree_id: treeId,
                status: 'created'
            });

        } catch (error: any) {
            console.error('[API] Error registering paper agent:', error);
            res.status(500).json({
                error: 'Failed to register paper agent',
                details: error.message
            });
        }
    });

    /**
     * Get agent information for a specific tree ID
     * GET /paper-agents/:treeId
     */
    router.get('/:treeId', async (req: Request, res: Response): Promise<void> => {
        try {
            const { treeId } = req.params;
            const agentInfo = agentRegistry.getAgentInfo(treeId);

            if (!agentInfo) {
                res.status(404).json({
                    error: 'Paper agent not found',
                    tree_id: treeId
                });
                return;
            }

            res.json({
                tree_id: treeId,
                paper_title: agentInfo.config.paperTitle,
                agent_url: agentInfo.agent.getAgentUrl(),
                agent_card: agentInfo.agentCard,
                status: agentInfo.status,
                created_at: agentInfo.createdAt,
                last_active: agentInfo.lastActive,
                config: {
                    host: agentInfo.config.host,
                    max_nodes: agentInfo.config.maxNodes
                }
            });

        } catch (error: any) {
            console.error('[API] Error getting paper agent:', error);
            res.status(500).json({
                error: 'Failed to get paper agent information',
                details: error.message
            });
        }
    });

    /**
     * Get agent card for a specific tree ID
     * GET /paper-agents/:treeId/card
     */
    router.get('/:treeId/card', async (req: Request, res: Response): Promise<void> => {
        try {
            const { treeId } = req.params;
            const agent = agentRegistry.getAgent(treeId);

            if (!agent) {
                res.status(404).json({
                    error: 'Paper agent not found',
                    tree_id: treeId
                });
                return;
            }

            res.json(agent.getAgentCard());

        } catch (error: any) {
            console.error('[API] Error getting agent card:', error);
            res.status(500).json({
                error: 'Failed to get agent card',
                details: error.message
            });
        }
    });

    /**
     * List all active paper agents
     * GET /paper-agents
     */
    router.get('/', async (req: Request, res: Response): Promise<void> => {
        try {
            const agents = agentRegistry.listActiveAgents();
            const stats = agentRegistry.getStats();

            res.json({
                agents,
                stats,
                total_count: agents.length
            });

        } catch (error: any) {
            console.error('[API] Error listing paper agents:', error);
            res.status(500).json({
                error: 'Failed to list paper agents',
                details: error.message
            });
        }
    });

    /**
     * Remove a paper agent
     * DELETE /paper-agents/:treeId
     */
    router.delete('/:treeId', async (req: Request, res: Response): Promise<void> => {
        try {
            const { treeId } = req.params;

            const removed = await agentRegistry.unregisterPaperAgent(treeId);

            if (removed) {
                res.json({
                    message: 'Paper agent removed successfully',
                    tree_id: treeId
                });
            } else {
                res.status(404).json({
                    error: 'Paper agent not found',
                    tree_id: treeId
                });
            }

        } catch (error: any) {
            console.error('[API] Error removing paper agent:', error);
            res.status(500).json({
                error: 'Failed to remove paper agent',
                details: error.message
            });
        }
    });

    /**
     * Test a paper agent with a question
     * POST /paper-agents/:treeId/test
     */
    router.post('/:treeId/test', async (req: Request, res: Response): Promise<void> => {
        try {
            const { treeId } = req.params;
            const { question } = req.body;

            if (!question) {
                res.status(400).json({
                    error: 'Missing required parameter: question'
                });
                return;
            }

            const agentInfo = agentRegistry.getAgentInfo(treeId);

            if (!agentInfo) {
                res.status(404).json({
                    error: 'Paper agent not found',
                    tree_id: treeId
                });
                return;
            }

            console.log(`[API] Testing paper agent ${treeId} with question: "${question}"`);

            // Create a SimpleAgentInterface instance for testing
            const testAgent = new SimpleAgentInterface(
                treeId,
                agentInfo.config.paperTitle || 'Test Agent',
                agentInfo.config.host || 'https://treer.ai'
            );

            // Ask the question and get response
            const startTime = Date.now();
            const response = await testAgent.ask(question, {
                max_nodes: agentInfo.config.maxNodes || 10,
                include_metadata: false
            });
            const duration = Date.now() - startTime;

            console.log(`[API] Agent test completed in ${duration}ms`);

            res.json({
                tree_id: treeId,
                question: question,
                response: response,
                duration_ms: duration,
                timestamp: new Date().toISOString(),
                agent_name: agentInfo.config.paperTitle || 'Test Agent'
            });

        } catch (error: any) {
            console.error('[API] Error testing paper agent:', error);
            res.status(500).json({
                error: 'Failed to test paper agent',
                details: error.message
            });
        }
    });

    /**
     * Health check for all paper agents
     * GET /paper-agents/health
     */
    router.get('/health', async (req: Request, res: Response): Promise<void> => {
        try {
            const healthReport = await agentRegistry.healthCheck();
            res.json(healthReport);

        } catch (error: any) {
            console.error('[API] Error in health check:', error);
            res.status(500).json({
                error: 'Failed to perform health check',
                details: error.message
            });
        }
    });

    /**
     * Cleanup inactive agents
     * POST /paper-agents/cleanup
     */
    router.post('/cleanup', async (req: Request, res: Response): Promise<void> => {
        try {
            const { maxIdleTimeMs } = req.body;
            const cleanedCount = await agentRegistry.cleanupInactiveAgents(maxIdleTimeMs);

            res.json({
                message: 'Cleanup completed',
                cleaned_agents: cleanedCount
            });

        } catch (error: any) {
            console.error('[API] Error in cleanup:', error);
            res.status(500).json({
                error: 'Failed to cleanup agents',
                details: error.message
            });
        }
    });

    return router;
}

export default router;
