import { AgentCard, TaskStore, InMemoryTaskStore, DefaultRequestHandler } from '@a2a-js/sdk/server';
import { A2AExpressApp } from '@a2a-js/sdk/server/express';
import express, { Express } from 'express';
import { PaperAgentConfig, PaperAgentCard, PaperAgentMetadata, PaperDiscussionSkill } from './types/paperAgent';
import { DiscussionAwarePaperAgentExecutor } from './discussionAwarePaperAgentExecutor';
import { enhancedSearch } from './beamSearchService';

/**
 * PaperAgent represents a specialized agent for a specific research paper
 * Each agent is configured with a specific tree ID and can engage in discussions about that paper
 */
export class PaperAgent {
    private config: PaperAgentConfig;
    private agentCard: PaperAgentCard;
    private executor: DiscussionAwarePaperAgentExecutor;
    private taskStore: TaskStore;
    private requestHandler: DefaultRequestHandler;
    private app: Express;
    private server?: any;
    private completedTasks: Map<string, any> = new Map(); // Store completed tasks for polling

    constructor(config: PaperAgentConfig) {
        this.config = config;
        this.agentCard = this.generateAgentCard();
        this.taskStore = new InMemoryTaskStore();
        this.executor = new DiscussionAwarePaperAgentExecutor(this.config);
        this.requestHandler = new DefaultRequestHandler(
            this.agentCard,
            this.taskStore,
            this.executor
        );
        this.app = express();
        this.setupRoutes();
    }

    /**
     * Generate a specialized Agent Card for this paper
     */
    private generateAgentCard(): PaperAgentCard {
        const paperTitle = this.config.paperTitle || `Paper ${this.config.treeId.slice(0, 8)}`;
        
        const metadata: PaperAgentMetadata = {
            paper_tree_id: this.config.treeId,
            paper_tree_url: this.config.treeUrl,
            paper_title: paperTitle,
            agent_type: 'paper_agent',
            specialization: 'single_paper_discussion',
            created_at: new Date().toISOString(),
            host: this.config.host || 'https://treer.ai'
        };

        const discussionSkills: PaperDiscussionSkill[] = [
            {
                id: 'discuss_methodology',
                name: 'Discuss Methodology',
                description: `Discuss the research methodology and approach used in "${paperTitle}"`,
                examples: [
                    'What methodology was used in this research?',
                    'How was the data collected?',
                    'What was the experimental design?'
                ]
            },
            {
                id: 'discuss_findings',
                name: 'Discuss Findings',
                description: `Discuss the key findings and results from "${paperTitle}"`,
                examples: [
                    'What are the main findings?',
                    'What were the most significant results?',
                    'How do these results compare to previous work?'
                ]
            },
            {
                id: 'compare_concepts',
                name: 'Compare Concepts',
                description: `Compare concepts from "${paperTitle}" with other research or theories`,
                examples: [
                    'How does this approach differ from X method?',
                    'What are the advantages over traditional approaches?',
                    'How does this relate to existing literature?'
                ]
            },
            {
                id: 'summarize_content',
                name: 'Summarize Content',
                description: `Provide summaries of different sections or aspects of "${paperTitle}"`,
                examples: [
                    'Summarize the introduction',
                    'What is the abstract of this paper?',
                    'Give an overview of the conclusions'
                ]
            },
            {
                id: 'participate_discussion',
                name: 'Participate in Academic Discussion',
                description: `Engage in multi-turn discussions with other paper agents about research topics related to "${paperTitle}"`,
                examples: [
                    'Discuss the methodology with another paper agent',
                    'Compare findings with related research',
                    'Engage in academic debate about approaches'
                ]
            }
        ];

        return {
            name: `Paper Research Agent - ${paperTitle}`,
            description: `Specialized agent representing the research paper: "${paperTitle}". This agent has deep knowledge of the paper's content and can engage in detailed discussions about its methodology, findings, and implications.`,
            version: '1.0.0',
            url: `http://localhost:${this.config.agentPort}/`,
            protocolVersion: '0.3.0',
            capabilities: {
                streaming: false,
                pushNotifications: false,
                stateTransitionHistory: true, // Enable state history for multi-turn conversations
            },
            defaultInputModes: ['text'],
            defaultOutputModes: ['text', 'task-status'],
            skills: discussionSkills.map(skill => ({
                id: skill.id,
                name: skill.name,
                description: skill.description,
                tags: ['discussion', 'research', 'paper-analysis', 'academic'],
                examples: skill.examples,
                inputModes: ['text'],
                outputModes: ['text', 'task-status']
            })),
            supportsAuthenticatedExtendedCard: false,
            metadata
        };
    }

    /**
     * Setup Express routes for this agent
     */
    private setupRoutes(): void {
        this.app.use(express.json({ limit: '50mb' }));
        
        // Setup A2A routes
        const a2aAppBuilder = new A2AExpressApp(this.requestHandler);
        a2aAppBuilder.setupRoutes(this.app);
        
        // Additional agent.json endpoint for compatibility
        this.app.get('/.well-known/agent.json', async (req, res) => {
            try {
                const agentCard = await this.requestHandler.getAgentCard();
                res.json(agentCard);
            } catch (error) {
                console.error(`[PaperAgent-${this.config.treeId}] Error fetching agent card:`, error);
                res.status(500).json({ error: 'Failed to retrieve agent card' });
            }
        });

        // Health check endpoint
        this.app.get('/health', (req, res) => {
            res.json({
                status: 'active',
                paper_id: this.config.treeId,
                paper_title: this.config.paperTitle,
                uptime: process.uptime()
            });
        });

        // Paper info endpoint
        this.app.get('/paper-info', (req, res) => {
            res.json({
                treeId: this.config.treeId,
                treeUrl: this.config.treeUrl,
                paperTitle: this.config.paperTitle,
                host: this.config.host,
                agentCard: this.agentCard
            });
        });

        // A2A tasks endpoint for task polling
        this.app.get('/a2a/tasks', async (req, res) => {
            try {
                const { contextId } = req.query;
                console.log(`[PaperAgent-${this.config.treeId}] Tasks query for contextId: ${contextId}`);
                
                // Get tasks from our internal store
                const allTasks = Array.from(this.completedTasks.values());
                
                // Filter tasks by contextId if provided
                let filteredTasks = allTasks;
                if (contextId) {
                    filteredTasks = allTasks.filter(task => task.contextId === contextId);
                    console.log(`[PaperAgent-${this.config.treeId}] Found ${filteredTasks.length} tasks for contextId ${contextId} out of ${allTasks.length} total tasks`);
                }
                
                res.json(filteredTasks);
                
            } catch (error) {
                console.error(`[PaperAgent-${this.config.treeId}] Error fetching tasks:`, error);
                res.status(500).json({ error: 'Failed to retrieve tasks' });
            }
        });

        // Manual A2A messages endpoint implementation
        this.app.post('/a2a/messages', async (req, res) => {
            try {
                console.log(`[PaperAgent-${this.config.treeId}] Received A2A message:`, JSON.stringify(req.body, null, 2));
                
                // Create proper A2A response using sendMessage
                const message = req.body;
                
                // Validate A2A message format
                if (!message.kind || !message.messageId || !message.contextId) {
                    throw new Error('Invalid A2A message format');
                }
                
                const result = await this.requestHandler.sendMessage({ message });
                
                console.log(`[PaperAgent-${this.config.treeId}] A2A response:`, JSON.stringify(result, null, 2));
                
                // Store the completed task for polling
                if (result && result.id && result.contextId) {
                    this.completedTasks.set(result.id, result);
                    console.log(`[PaperAgent-${this.config.treeId}] Stored task ${result.id} for contextId ${result.contextId}`);
                }
                
                res.json(result);
                
            } catch (error) {
                console.error(`[PaperAgent-${this.config.treeId}] Error handling A2A message:`, error);
                res.status(500).json({ 
                    error: 'Failed to process A2A message',
                    details: error.message 
                });
            }
        });

        // Debug: Check if A2A routes are properly setup
        this.app.get('/debug/routes', (req, res) => {
            const routes = [];
            this.app._router.stack.forEach((middleware) => {
                if (middleware.route) {
                    routes.push({
                        path: middleware.route.path,
                        methods: Object.keys(middleware.route.methods)
                    });
                }
            });
            res.json({ routes });
        });
    }

    /**
     * Initialize the agent and start the HTTP server
     */
    async initialize(): Promise<void> {
        try {
            // Try to extract paper title if not provided
            if (!this.config.paperTitle) {
                await this.extractPaperTitle();
                // Regenerate agent card with the extracted title
                this.agentCard = this.generateAgentCard();
                // Update the request handler with new card
                this.requestHandler = new DefaultRequestHandler(
                    this.agentCard,
                    this.taskStore,
                    this.executor
                );
            }

            // Start HTTP server
            return new Promise((resolve, reject) => {
                this.server = this.app.listen(this.config.agentPort, () => {
                    console.log(`[PaperAgent] "${this.config.paperTitle}" started at http://localhost:${this.config.agentPort}`);
                    console.log(`[PaperAgent] Tree ID: ${this.config.treeId}`);
                    console.log(`[PaperAgent] Agent Card: http://localhost:${this.config.agentPort}/.well-known/agent.json`);
                    resolve();
                });
                
                this.server.on('error', (error: any) => {
                    if (error.code === 'EADDRINUSE') {
                        reject(new Error(`Port ${this.config.agentPort} is already in use`));
                    } else {
                        reject(error);
                    }
                });
            });
        } catch (error) {
            console.error(`[PaperAgent] Failed to initialize agent for tree ${this.config.treeId}:`, error);
            throw error;
        }
    }

    /**
     * Extract paper title from the tree content
     */
    private async extractPaperTitle(): Promise<void> {
        try {
            console.log(`[PaperAgent] Extracting paper title for tree ${this.config.treeId}...`);
            
            const searchResult = await enhancedSearch(
                'What is the title of this paper?',
                this.config.treeId,
                this.config.host || 'https://treer.ai',
                { max_nodes: 3, include_metadata: false }
            );

            if (searchResult.matched_nodes.length > 0) {
                // Look for title in the first few nodes
                const titleNode = searchResult.matched_nodes[0];
                const extractedTitle = titleNode.title || titleNode.content.slice(0, 100).trim();
                
                if (extractedTitle && extractedTitle.length > 5) {
                    this.config.paperTitle = extractedTitle;
                    console.log(`[PaperAgent] Extracted title: "${extractedTitle}"`);
                } else {
                    this.config.paperTitle = `Research Paper ${this.config.treeId.slice(0, 8)}`;
                }
            } else {
                this.config.paperTitle = `Research Paper ${this.config.treeId.slice(0, 8)}`;
            }
        } catch (error) {
            console.warn(`[PaperAgent] Failed to extract paper title:`, error.message);
            this.config.paperTitle = `Research Paper ${this.config.treeId.slice(0, 8)}`;
        }
    }

    /**
     * Stop the agent and close the HTTP server
     */
    async stop(): Promise<void> {
        return new Promise((resolve) => {
            if (this.server) {
                this.server.close(() => {
                    console.log(`[PaperAgent] Stopped agent for paper "${this.config.paperTitle}"`);
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }

    /**
     * Get the agent's configuration
     */
    getConfig(): PaperAgentConfig {
        return { ...this.config };
    }

    /**
     * Get the agent's card
     */
    getAgentCard(): PaperAgentCard {
        return this.agentCard;
    }

    /**
     * Get the agent's URL
     */
    getAgentUrl(): string {
        return this.agentCard.url;
    }

    /**
     * Check if the agent is running
     */
    isRunning(): boolean {
        return !!this.server && this.server.listening;
    }
}