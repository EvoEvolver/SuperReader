import { Router, Request, Response } from 'express';
import { DiscussionCoordinator } from '../discussionCoordinator';
import { IntelligentDiscussionCoordinator, DiscussionConfig } from '../intelligentDiscussionCoordinator';

const router = Router();

// Function to initialize routes with coordinators
export function createDiscussionRoutes(
    discussionCoordinator: DiscussionCoordinator,
    intelligentDiscussionCoordinator: IntelligentDiscussionCoordinator
): Router {

    /**
     * Initiate an intelligent discussion between two paper agents
     * POST /discussions/initiate
     */
    router.post('/initiate', async (req: Request, res: Response): Promise<void> => {
        try {
            const { topic, agent1TreeId, agent2TreeId, maxRounds = 5, agent1Name, agent2Name } = req.body;

            if (!topic || !agent1TreeId || !agent2TreeId) {
                res.status(400).json({
                    error: 'Missing required parameters: topic, agent1TreeId, agent2TreeId'
                });
                return;
            }

            console.log(`[API] Starting intelligent discussion:`, {
                topic,
                agent1TreeId,
                agent2TreeId,
                maxRounds
            });

            // Create discussion configuration for intelligent coordinator
            const discussionConfig: DiscussionConfig = {
                topic,
                maxRounds,
                agentA: {
                    treeId: agent1TreeId,
                    name: agent1Name || 'Agent A'
                },
                agentB: {
                    treeId: agent2TreeId,
                    name: agent2Name || 'Agent B'
                }
            };

            const discussionId = await intelligentDiscussionCoordinator.initiateDiscussion(discussionConfig);

            res.json({
                message: 'Intelligent discussion initiated successfully',
                discussionId: discussionId,
                topic,
                participants: {
                    agent1: {
                        tree_id: agent1TreeId,
                        name: agent1Name || 'Agent A'
                    },
                    agent2: {
                        tree_id: agent2TreeId,
                        name: agent2Name || 'Agent B'
                    }
                },
                max_rounds: maxRounds,
                status: 'initiated'
            });

        } catch (error: any) {
            console.error('[API] Error initiating intelligent discussion:', error);
            res.status(500).json({
                error: 'Failed to initiate discussion',
                details: error.message
            });
        }
    });

    /**
     * Get discussion coordinator statistics
     * GET /discussions/stats
     */
    router.get('/stats', async (req: Request, res: Response): Promise<void> => {
        try {
            const stats = discussionCoordinator.getStats();
            res.json(stats);

        } catch (error: any) {
            console.error('[API] Error getting discussion stats:', error);
            res.status(500).json({
                error: 'Failed to get discussion statistics',
                details: error.message
            });
        }
    });

    /**
     * Get intelligent discussion status
     * GET /discussions/:discussionId
     */
    router.get('/:discussionId', async (req: Request, res: Response): Promise<void> => {
        try {
            const { discussionId } = req.params;
            const discussion = intelligentDiscussionCoordinator.getDiscussionState(discussionId);

            if (!discussion) {
                res.status(404).json({
                    error: 'Discussion not found',
                    discussionId: discussionId
                });
                return;
            }

            res.json({
                discussionId: discussionId,
                topic: discussion.topic,
                status: discussion.status,
                currentRound: discussion.currentRound,
                maxRounds: discussion.maxRounds,
                participants: {
                    agent1Url: `Agent: ${discussion.agentAInfo.name}`,
                    agent2Url: `Agent: ${discussion.agentBInfo.name}`
                },
                messageCount: discussion.turns.length * 4, // question + 2 responses + analysis per turn
                startedAt: discussion.startTime.toISOString(),
                lastMessageAt: discussion.turns.length > 0 ?
                    discussion.turns[discussion.turns.length - 1].timestamp :
                    discussion.startTime.toISOString(),
                completedAt: discussion.endTime?.toISOString(),
                recent_messages: discussion.turns.slice(-2).flatMap(turn => [
                    {
                        role: 'coordinator',
                        text: turn.question,
                        round: turn.round,
                        timestamp: turn.timestamp
                    },
                    {
                        role: 'agent',
                        text: turn.agentAResponse.slice(0, 200) + '...',
                        agent_name: discussion.agentAInfo.name,
                        round: turn.round,
                        timestamp: turn.timestamp
                    },
                    {
                        role: 'agent',
                        text: turn.agentBResponse.slice(0, 200) + '...',
                        agent_name: discussion.agentBInfo.name,
                        round: turn.round,
                        timestamp: turn.timestamp
                    }
                ])
            });

        } catch (error: any) {
            console.error('[API] Error getting intelligent discussion:', error);
            res.status(500).json({
                error: 'Failed to get discussion information',
                details: error.message
            });
        }
    });

    /**
     * Get full intelligent discussion history
     * GET /discussions/:discussionId/history
     */
    router.get('/:discussionId/history', async (req: Request, res: Response): Promise<void> => {
        try {
            const { discussionId } = req.params;
            const discussion = intelligentDiscussionCoordinator.getDiscussionState(discussionId);

            if (!discussion) {
                res.status(404).json({
                    error: 'Discussion not found'
                });
                return;
            }

            // Convert turns into message format that frontend expects
            const messages = discussion.turns.flatMap(turn => [
                {
                    messageId: `coordinator-${turn.round}`,
                    role: 'user', // coordinator question
                    content: turn.question,
                    timestamp: turn.timestamp,
                    agentId: 'coordinator',
                    agentName: 'Discussion Coordinator',
                    roundNumber: turn.round
                },
                {
                    messageId: `agent-a-${turn.round}`,
                    role: 'assistant', // agent response
                    content: turn.agentAResponse,
                    timestamp: turn.timestamp,
                    agentId: discussion.agentAInfo.treeId,
                    agentName: discussion.agentAInfo.name,
                    roundNumber: turn.round
                },
                {
                    messageId: `agent-b-${turn.round}`,
                    role: 'assistant', // agent response
                    content: turn.agentBResponse,
                    timestamp: turn.timestamp,
                    agentId: discussion.agentBInfo.treeId,
                    agentName: discussion.agentBInfo.name,
                    roundNumber: turn.round
                },
                {
                    messageId: `analysis-${turn.round}`,
                    role: 'system', // coordinator analysis
                    content: turn.coordinatorAnalysis,
                    timestamp: turn.timestamp,
                    agentId: 'coordinator',
                    agentName: 'Discussion Analysis',
                    roundNumber: turn.round
                }
            ]);

            // Add summary as final message if discussion is completed
            if (discussion.status === 'completed' && discussion.summary) {
                messages.push({
                    messageId: `summary-${discussionId}`,
                    role: 'system',
                    content: discussion.summary,
                    timestamp: discussion.endTime?.toISOString() || new Date().toISOString(),
                    agentId: 'coordinator',
                    agentName: 'Discussion Summary',
                    roundNumber: discussion.turns.length + 1
                });
            }

            res.json({
                discussionId,
                messages,
                status: {
                    discussionId,
                    status: discussion.status,
                    currentRound: discussion.currentRound,
                    maxRounds: discussion.maxRounds,
                    topic: discussion.topic,
                    startedAt: discussion.startTime.toISOString(),
                    completedAt: discussion.endTime?.toISOString(),
                    participantCount: 2,
                    messageCount: messages.length,
                    lastMessageAt: discussion.turns.length > 0 ?
                        discussion.turns[discussion.turns.length - 1].timestamp :
                        discussion.startTime.toISOString()
                }
            });

        } catch (error: any) {
            console.error('[API] Error getting intelligent discussion history:', error);
            res.status(500).json({
                error: 'Failed to get discussion history',
                details: error.message
            });
        }
    });

    /**
     * List active discussions
     * GET /discussions
     */
    router.get('/', async (req: Request, res: Response): Promise<void> => {
        try {
            const discussions = discussionCoordinator.getActiveDiscussions();
            const stats = discussionCoordinator.getStats();

            res.json({
                discussions: discussions.map(d => ({
                    discussion_id: d.discussionId,
                    topic: d.topic,
                    status: d.status,
                    current_round: d.currentRound,
                    max_rounds: d.maxRounds,
                    participants: d.participants,
                    start_time: d.startTime,
                    last_activity: d.lastActivity
                })),
                statistics: stats,
                total_count: discussions.length
            });

        } catch (error: any) {
            console.error('[API] Error listing discussions:', error);
            res.status(500).json({
                error: 'Failed to list discussions',
                details: error.message
            });
        }
    });

    /**
     * Conclude an intelligent discussion manually
     * POST /discussions/:discussionId/conclude
     */
    router.post('/:discussionId/conclude', async (req: Request, res: Response): Promise<void> => {
        try {
            const { discussionId } = req.params;
            await intelligentDiscussionCoordinator.concludeDiscussion(discussionId);

            const discussion = intelligentDiscussionCoordinator.getDiscussionState(discussionId);

            res.json({
                message: 'Intelligent discussion concluded successfully',
                discussionId: discussionId,
                status: discussion?.status || 'concluded',
                summary: discussion?.summary || 'Discussion concluded manually'
            });

        } catch (error: any) {
            console.error('[API] Error concluding intelligent discussion:', error);
            res.status(500).json({
                error: 'Failed to conclude discussion',
                details: error.message
            });
        }
    });

    return router;
}

export default router;
