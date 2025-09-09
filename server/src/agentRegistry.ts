import { PaperAgent } from './paperAgent';
import { PaperAgentConfig, PaperAgentEntry } from './types/paperAgent';
import net from 'net';

/**
 * AgentRegistry manages multiple PaperAgent instances
 * Each agent runs on its own port and represents a specific research paper
 */
export class AgentRegistry {
    private agents: Map<string, PaperAgentEntry> = new Map();
    private portRange = { start: 8090, end: 8190 }; // Port range for paper agents
    private usedPorts = new Set<number>();

    constructor() {
        console.log('[AgentRegistry] Initialized with port range', this.portRange);
    }

    /**
     * Register a new paper agent
     */
    async registerPaperAgent(
        treeId: string, 
        config: Partial<PaperAgentConfig> = {}
    ): Promise<PaperAgent> {
        console.log(`[AgentRegistry] Registering paper agent for tree ID: ${treeId}`);

        // Check if agent already exists
        if (this.agents.has(treeId)) {
            const existingEntry = this.agents.get(treeId)!;
            if (existingEntry.status === 'active') {
                console.log(`[AgentRegistry] Agent for ${treeId} already exists and is active`);
                return existingEntry.agent;
            } else {
                // Remove inactive agent
                console.log(`[AgentRegistry] Removing inactive agent for ${treeId}`);
                await this.unregisterPaperAgent(treeId);
            }
        }

        try {
            // No individual ports needed - using unified routing
            const agentPort = 0;

            // Create full configuration
            const fullConfig: PaperAgentConfig = {
                treeId,
                treeUrl: config.treeUrl || `https://treer.ai/?id=${treeId}`,
                paperTitle: config.paperTitle,
                host: config.host || 'https://treer.ai',
                agentPort,
                maxNodes: config.maxNodes || 15, // Updated default value
                ...config
            };

            // Create and initialize agent
            const agent = new PaperAgent(fullConfig);
            
            // Create registry entry
            const entry: PaperAgentEntry = {
                agent,
                config: fullConfig,
                agentCard: agent.getAgentCard(),
                createdAt: new Date(),
                lastActive: new Date(),
                status: 'initializing'
            };

            // Store in registry
            this.agents.set(treeId, entry);
            // No port management needed with unified routing

            // Initialize the agent
            await agent.initialize();
            
            // Update status to active
            entry.status = 'active';
            entry.lastActive = new Date();

            console.log(`[AgentRegistry] Successfully registered and started agent for "${fullConfig.paperTitle}"`);
            console.log(`[AgentRegistry] Agent URL: ${agent.getAgentUrl()}`);

            return agent;

        } catch (error) {
            console.error(`[AgentRegistry] Failed to register agent for ${treeId}:`, error);
            
            // Clean up on failure
            const entry = this.agents.get(treeId);
            if (entry) {
                entry.status = 'error';
                if (entry.config.agentPort) {
                    this.usedPorts.delete(entry.config.agentPort);
                }
            }
            
            throw error;
        }
    }

    /**
     * Unregister and stop a paper agent
     */
    async unregisterPaperAgent(treeId: string): Promise<boolean> {
        console.log(`[AgentRegistry] Unregistering paper agent for tree ID: ${treeId}`);

        const entry = this.agents.get(treeId);
        if (!entry) {
            console.log(`[AgentRegistry] No agent found for ${treeId}`);
            return false;
        }

        try {
            // Stop the agent (no HTTP server to stop with unified routing)
            if (entry.agent && entry.agent.isRunning()) {
                await entry.agent.stop();
            }

            // No port cleanup needed with unified routing

            // Remove from registry
            this.agents.delete(treeId);

            console.log(`[AgentRegistry] Successfully unregistered agent for ${treeId}`);
            return true;

        } catch (error) {
            console.error(`[AgentRegistry] Error unregistering agent for ${treeId}:`, error);
            return false;
        }
    }

    /**
     * Get an existing paper agent
     */
    getAgent(treeId: string): PaperAgent | undefined {
        const entry = this.agents.get(treeId);
        if (entry && entry.status === 'active') {
            entry.lastActive = new Date(); // Update last active time
            return entry.agent;
        }
        return undefined;
    }

    /**
     * Get all registered agents
     */
    getAllAgents(): Map<string, PaperAgentEntry> {
        return new Map(this.agents);
    }

    /**
     * Get agent information
     */
    getAgentInfo(treeId: string): PaperAgentEntry | undefined {
        return this.agents.get(treeId);
    }

    /**
     * List all active agents
     */
    listActiveAgents(): Array<{
        treeId: string;
        paperTitle: string;
        agentUrl: string;
        status: string;
        createdAt: Date;
        lastActive: Date;
    }> {
        return Array.from(this.agents.entries()).map(([treeId, entry]) => ({
            treeId,
            paperTitle: entry.config.paperTitle || 'Unknown',
            agentUrl: entry.agent?.getAgentUrl() || '',
            status: entry.status,
            createdAt: entry.createdAt,
            lastActive: entry.lastActive
        }));
    }

    /**
     * Find an available port in the configured range
     */
    private async findAvailablePort(): Promise<number> {
        for (let port = this.portRange.start; port <= this.portRange.end; port++) {
            if (!this.usedPorts.has(port) && await this.isPortAvailable(port)) {
                return port;
            }
        }
        throw new Error(`No available ports in range ${this.portRange.start}-${this.portRange.end}`);
    }

    /**
     * Check if a port is available
     */
    private isPortAvailable(port: number): Promise<boolean> {
        return new Promise((resolve) => {
            const server = net.createServer();
            
            server.listen(port, () => {
                server.close(() => {
                    resolve(true);
                });
            });

            server.on('error', () => {
                resolve(false);
            });
        });
    }

    /**
     * Health check for all agents
     */
    async healthCheck(): Promise<{
        totalAgents: number;
        activeAgents: number;
        errorAgents: number;
        agents: Array<{
            treeId: string;
            status: string;
            isRunning: boolean;
            agentUrl?: string;
        }>;
    }> {
        const agents = [];
        let activeCount = 0;
        let errorCount = 0;

        for (const [treeId, entry] of this.agents.entries()) {
            let isRunning = false;
            let currentStatus = entry.status;

            try {
                isRunning = entry.agent ? entry.agent.isRunning() : false;
                if (entry.status === 'active' && !isRunning) {
                    currentStatus = 'stopped';
                    entry.status = 'stopped';
                }
            } catch (error) {
                currentStatus = 'error';
                entry.status = 'error';
            }

            if (currentStatus === 'active') activeCount++;
            if (currentStatus === 'error') errorCount++;

            agents.push({
                treeId,
                status: currentStatus,
                isRunning,
                agentUrl: entry.agent?.getAgentUrl()
            });
        }

        return {
            totalAgents: this.agents.size,
            activeAgents: activeCount,
            errorAgents: errorCount,
            agents
        };
    }

    /**
     * Clean up inactive agents
     */
    async cleanupInactiveAgents(maxIdleTimeMs: number = 30 * 60 * 1000): Promise<number> {
        const now = new Date();
        const agentsToRemove: string[] = [];

        for (const [treeId, entry] of this.agents.entries()) {
            const idleTime = now.getTime() - entry.lastActive.getTime();
            if (idleTime > maxIdleTimeMs && entry.status !== 'active') {
                agentsToRemove.push(treeId);
            }
        }

        console.log(`[AgentRegistry] Cleaning up ${agentsToRemove.length} inactive agents`);

        let cleanedCount = 0;
        for (const treeId of agentsToRemove) {
            if (await this.unregisterPaperAgent(treeId)) {
                cleanedCount++;
            }
        }

        return cleanedCount;
    }

    /**
     * Shutdown all agents
     */
    async shutdown(): Promise<void> {
        console.log(`[AgentRegistry] Shutting down ${this.agents.size} agents...`);

        const shutdownPromises = Array.from(this.agents.keys()).map(treeId => 
            this.unregisterPaperAgent(treeId)
        );

        await Promise.all(shutdownPromises);
        
        this.agents.clear();
        this.usedPorts.clear();

        console.log('[AgentRegistry] All agents shut down successfully');
    }

    /**
     * Get registry statistics
     */
    getStats(): {
        totalAgents: number;
        activeAgents: number;
        usedPorts: number[];
        portRange: { start: number; end: number };
    } {
        const activeAgents = Array.from(this.agents.values())
            .filter(entry => entry.status === 'active').length;

        return {
            totalAgents: this.agents.size,
            activeAgents,
            usedPorts: Array.from(this.usedPorts).sort(),
            portRange: this.portRange
        };
    }
}