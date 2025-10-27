import { Router, Request, Response, NextFunction } from 'express';
import { AgentRegistry } from '../agentRegistry';

const router = Router();

/**
 * Function to create agent proxy middleware
 * This proxies all requests to /agents/:treeId/* to the appropriate paper agent
 */
export function createAgentProxyRoutes(agentRegistry: AgentRegistry): Router {

    /**
     * Proxy route for agent access
     * ALL /agents/:treeId/* -> agent instance
     */
    router.use('/:treeId', (req: Request, res: Response, next: NextFunction) => {
        try {
            const { treeId } = req.params;
            const agentInfo = agentRegistry.getAgentInfo(treeId);

            if (!agentInfo || agentInfo.status !== 'active') {
                return res.status(404).json({
                    error: 'Agent not found or not active',
                    tree_id: treeId
                });
            }

            const agent = agentInfo.agent;
            if (!agent) {
                return res.status(500).json({
                    error: 'Agent instance not available',
                    tree_id: treeId
                });
            }

            // Get the agent's internal express app and use it to handle the request
            const agentApp = agent.getExpressApp();
            if (agentApp) {
                // Remove the /agents/:treeId prefix from the request path
                const originalUrl = req.url;
                const pathWithoutPrefix = req.url.replace(new RegExp(`^/agents/${treeId}`), '') || '/';

                // Modify request to match the agent's expected paths
                req.url = pathWithoutPrefix;
                req.originalUrl = originalUrl;

                console.log(`[Agent Proxy] Routing ${originalUrl} -> ${pathWithoutPrefix} for agent ${treeId}`);

                // Forward to the agent's express app
                agentApp(req, res, next);
            } else {
                return res.status(500).json({
                    error: 'Agent express app not available',
                    tree_id: treeId
                });
            }

        } catch (error: any) {
            console.error('[Agent Proxy] Error:', error);
            res.status(500).json({
                error: 'Internal server error in agent proxy',
                details: error.message
            });
        }
    });

    return router;
}

export default router;
