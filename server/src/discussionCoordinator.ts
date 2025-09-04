import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import { 
    A2ADiscussionConfig, 
    DiscussionContext, 
    DiscussionMessage, 
    DiscussionTaskState,
    DiscussionEvent,
    DiscussionSummary,
    AgentRouting,
    DiscussionCapableAgent
} from './types/discussion';
import { Message, Task } from '@a2a-js/sdk';

/**
 * DiscussionCoordinator manages A2A protocol compliant multi-turn discussions
 * between two paper agents, following strict A2A message formats and contextId management
 */
export class DiscussionCoordinator {
    private activeDiscussions: Map<string, DiscussionContext> = new Map();
    private eventListeners: Array<(event: DiscussionEvent) => void> = [];

    /**
     * Initiate a new discussion between two paper agents
     */
    async initiateDiscussion(config: A2ADiscussionConfig): Promise<string> {
        console.log(`[DiscussionCoordinator] Initiating discussion on topic: "${config.topic}"`);
        
        // Verify both agents support discussions
        const [agent1Info, agent2Info] = await Promise.all([
            this.verifyAgentCapabilities(config.participants[0]),
            this.verifyAgentCapabilities(config.participants[1])
        ]);

        if (!agent1Info.supportsDiscussion || !agent2Info.supportsDiscussion) {
            throw new Error('One or both agents do not support multi-turn discussions');
        }

        // Create discussion context with A2A contextId
        const discussionId = uuidv4();
        const discussionContext: DiscussionContext = {
            discussionId,
            topic: config.topic,
            contextId: config.sharedContextId,
            participants: {
                agent1Url: config.participants[0],
                agent2Url: config.participants[1]
            },
            currentRound: 1,
            maxRounds: config.maxRounds,
            status: 'initializing',
            taskHistory: [],
            messageHistory: [],
            startTime: new Date(),
            lastActivity: new Date()
        };

        this.activeDiscussions.set(discussionId, discussionContext);
        this.emitEvent({ type: 'discussion_started', data: discussionContext });

        try {
            // Send initial discussion invite to agent1 (the initiator)
            const initialMessage = this.createDiscussionMessage(
                config.topic,
                config.sharedContextId,
                1,
                'initiator',
                config.participants[1] // target agent
            );

            await this.sendMessageToAgent(config.participants[0], initialMessage);
            
            discussionContext.status = 'active';
            discussionContext.messageHistory.push(initialMessage);
            
            console.log(`[DiscussionCoordinator] Discussion ${discussionId} started successfully`);
            
            // Start the discussion flow asynchronously
            this.runDiscussionFlow(discussionContext).catch(error => {
                console.error(`[DiscussionCoordinator] Discussion flow error:`, error);
                discussionContext.status = 'error';
            });
            
            return discussionId;

        } catch (error) {
            discussionContext.status = 'error';
            this.emitEvent({ 
                type: 'discussion_error', 
                data: { error: error.message, contextId: config.sharedContextId } 
            });
            throw error;
        }
    }

    /**
     * Handle response from an agent and route to the other participant
     */
    async handleAgentResponse(
        sourceAgentUrl: string, 
        message: Message,
        taskId?: string
    ): Promise<void> {
        const contextId = message.contextId;
        const discussion = this.findDiscussionByContextId(contextId);
        
        if (!discussion) {
            console.warn(`[DiscussionCoordinator] No active discussion found for contextId: ${contextId}`);
            return;
        }

        console.log(`[DiscussionCoordinator] Handling response from ${sourceAgentUrl} in round ${discussion.currentRound}`);

        // Update discussion context
        discussion.lastActivity = new Date();
        
        // Determine target agent
        const targetAgentUrl = sourceAgentUrl === discussion.participants.agent1Url 
            ? discussion.participants.agent2Url 
            : discussion.participants.agent1Url;

        // Create A2A compliant discussion message for the target agent
        const discussionMessage: DiscussionMessage = {
            kind: 'message',
            role: 'user',
            messageId: uuidv4(),
            contextId: discussion.contextId,
            referenceTaskIds: taskId ? [taskId] : undefined,
            parts: message.parts,
            metadata: {
                discussionMode: true,
                discussionRound: discussion.currentRound,
                targetAgentUrl,
                originalTopic: discussion.topic,
                participantRole: sourceAgentUrl === discussion.participants.agent1Url ? 'initiator' : 'responder',
                conversationType: 'bilateral_discussion'
            }
        };

        try {
            // Send message to target agent
            await this.sendMessageToAgent(targetAgentUrl, discussionMessage);
            
            // Update discussion state
            discussion.messageHistory.push(discussionMessage);
            discussion.currentRound++;
            
            this.emitEvent({ 
                type: 'message_sent', 
                data: { 
                    from: sourceAgentUrl, 
                    to: targetAgentUrl, 
                    message: discussionMessage 
                } 
            });

            // Check if discussion should continue
            if (!this.shouldContinueDiscussion(discussion)) {
                await this.concludeDiscussion(discussion.discussionId);
            }

        } catch (error) {
            console.error(`[DiscussionCoordinator] Error routing message:`, error);
            discussion.status = 'error';
            this.emitEvent({ 
                type: 'discussion_error', 
                data: { error: error.message, contextId } 
            });
        }
    }

    /**
     * Conclude a discussion and generate summary
     */
    async concludeDiscussion(discussionId: string): Promise<DiscussionSummary> {
        const discussion = this.activeDiscussions.get(discussionId);
        if (!discussion) {
            throw new Error(`Discussion ${discussionId} not found`);
        }

        console.log(`[DiscussionCoordinator] Concluding discussion: ${discussionId}`);
        
        discussion.status = 'concluded';
        
        // Generate summary
        const summary: DiscussionSummary = {
            discussionId,
            topic: discussion.topic,
            totalRounds: discussion.currentRound - 1,
            participants: [discussion.participants.agent1Url, discussion.participants.agent2Url],
            keyPoints: this.extractKeyPoints(discussion.messageHistory),
            consensus: [], // TODO: Implement consensus detection
            differences: [], // TODO: Implement difference detection
            conclusion: `Discussion concluded after ${discussion.currentRound - 1} rounds.`,
            generatedAt: new Date()
        };

        this.emitEvent({ type: 'discussion_concluded', data: { contextId: discussion.contextId, summary } });
        
        // Keep discussion in memory for a while before cleanup
        setTimeout(() => {
            this.activeDiscussions.delete(discussionId);
        }, 60000); // Clean up after 1 minute

        return summary;
    }

    /**
     * Send A2A compliant message to an agent
     */
    private async sendMessageToAgent(agentUrl: string, message: DiscussionMessage): Promise<void> {
        try {
            console.log(`[DiscussionCoordinator] Sending message to ${agentUrl}`);
            
            // Use A2A standard endpoint
            const cleanUrl = agentUrl.replace(/\/$/, '');
            const response = await axios.post(`${cleanUrl}/a2a/messages`, message, {
                headers: {
                    'Content-Type': 'application/json',
                    'A2A-Protocol-Version': '0.3.0'
                },
                timeout: 30000 // 30 second timeout
            });

            console.log(`[DiscussionCoordinator] Message sent successfully, status: ${response.status}`);

        } catch (error) {
            console.error(`[DiscussionCoordinator] Failed to send message to ${agentUrl}:`, error.message);
            throw new Error(`Failed to communicate with agent at ${agentUrl}: ${error.message}`);
        }
    }

    /**
     * Verify agent supports discussion capabilities
     */
    private async verifyAgentCapabilities(agentUrl: string): Promise<DiscussionCapableAgent> {
        try {
            console.log(`[DiscussionCoordinator] Verifying capabilities for: ${agentUrl}`);
            const cleanUrl = agentUrl.replace(/\/$/, '');
            const response = await axios.get(`${cleanUrl}/.well-known/agent.json`);
            const agentCard = response.data;
            
            console.log(`[DiscussionCoordinator] Agent Card received:`, {
                name: agentCard.name,
                capabilities: agentCard.capabilities,
                skillIds: agentCard.skills?.map(s => s.id) || []
            });
            
            const hasStateHistory = agentCard.capabilities?.stateTransitionHistory === true;
            const hasDiscussionSkill = agentCard.skills?.some((skill: any) => skill.id === 'participate_discussion');
            
            console.log(`[DiscussionCoordinator] Capability check results:`, {
                hasStateHistory,
                hasDiscussionSkill,
                supportsDiscussion: hasStateHistory && hasDiscussionSkill
            });
            
            const supportsDiscussion = hasStateHistory && hasDiscussionSkill;
            
            return {
                agentUrl,
                agentCard: {
                    name: agentCard.name,
                    capabilities: agentCard.capabilities,
                    skills: agentCard.skills
                },
                supportsDiscussion
            };

        } catch (error) {
            console.error(`[DiscussionCoordinator] Failed to verify agent capabilities:`, error.message);
            return {
                agentUrl,
                agentCard: { name: 'Unknown', capabilities: {}, skills: [] },
                supportsDiscussion: false
            };
        }
    }

    /**
     * Create A2A compliant discussion message
     */
    private createDiscussionMessage(
        topic: string,
        contextId: string,
        round: number,
        role: 'initiator' | 'responder',
        targetAgentUrl?: string
    ): DiscussionMessage {
        return {
            kind: 'message',
            role: 'user',
            messageId: uuidv4(),
            contextId,
            parts: [{
                kind: 'text',
                text: `Let's discuss the topic: "${topic}". Please share your perspective based on your paper's research.`
            }],
            metadata: {
                discussionMode: true,
                discussionRound: round,
                targetAgentUrl,
                originalTopic: topic,
                participantRole: role,
                conversationType: 'bilateral_discussion'
            }
        };
    }

    /**
     * Check if discussion should continue
     */
    private shouldContinueDiscussion(discussion: DiscussionContext): boolean {
        // Check round limit (allow one more round to complete the discussion)
        if (discussion.currentRound >= discussion.maxRounds) {
            console.log(`[DiscussionCoordinator] Round limit reached: ${discussion.currentRound}/${discussion.maxRounds}`);
            return false;
        }

        // Check for timeout (2 hours max)
        const maxDurationMs = 2 * 60 * 60 * 1000;
        if (Date.now() - discussion.startTime.getTime() > maxDurationMs) {
            console.log(`[DiscussionCoordinator] Discussion timeout reached`);
            discussion.status = 'timeout';
            return false;
        }

        // Check for recent activity (15 minutes max idle)
        const maxIdleMs = 15 * 60 * 1000;
        if (Date.now() - discussion.lastActivity.getTime() > maxIdleMs) {
            console.log(`[DiscussionCoordinator] Discussion idle timeout`);
            discussion.status = 'timeout';
            return false;
        }

        return true;
    }

    /**
     * Find discussion by contextId
     */
    private findDiscussionByContextId(contextId: string): DiscussionContext | undefined {
        return Array.from(this.activeDiscussions.values())
            .find(discussion => discussion.contextId === contextId);
    }

    /**
     * Extract key points from message history (simplified implementation)
     */
    private extractKeyPoints(messages: DiscussionMessage[]): string[] {
        // TODO: Implement more sophisticated key point extraction
        return messages.slice(0, 5).map(msg => 
            msg.parts[0]?.text?.slice(0, 100) + '...'
        ).filter(point => point && point.length > 10);
    }

    /**
     * Add event listener for discussion events
     */
    addEventListener(listener: (event: DiscussionEvent) => void): void {
        this.eventListeners.push(listener);
    }

    /**
     * Remove event listener
     */
    removeEventListener(listener: (event: DiscussionEvent) => void): void {
        const index = this.eventListeners.indexOf(listener);
        if (index > -1) {
            this.eventListeners.splice(index, 1);
        }
    }

    /**
     * Emit event to all listeners
     */
    private emitEvent(event: DiscussionEvent): void {
        this.eventListeners.forEach(listener => {
            try {
                listener(event);
            } catch (error) {
                console.error('[DiscussionCoordinator] Error in event listener:', error);
            }
        });
    }

    /**
     * Get active discussions
     */
    getActiveDiscussions(): DiscussionContext[] {
        return Array.from(this.activeDiscussions.values());
    }

    /**
     * Get discussion by ID
     */
    getDiscussion(discussionId: string): DiscussionContext | undefined {
        return this.activeDiscussions.get(discussionId);
    }

    /**
     * Get discussion statistics
     */
    getStats(): {
        totalDiscussions: number;
        activeDiscussions: number;
        concludedDiscussions: number;
        averageRounds: number;
    } {
        const discussions = Array.from(this.activeDiscussions.values());
        const activeCount = discussions.filter(d => d.status === 'active').length;
        const concludedCount = discussions.filter(d => d.status === 'concluded').length;
        const averageRounds = discussions.length > 0 
            ? discussions.reduce((sum, d) => sum + d.currentRound, 0) / discussions.length 
            : 0;

        return {
            totalDiscussions: discussions.length,
            activeDiscussions: activeCount,
            concludedDiscussions: concludedCount,
            averageRounds: Math.round(averageRounds * 100) / 100
        };
    }

    /**
     * Run the complete discussion flow, handling multiple rounds
     */
    private async runDiscussionFlow(discussion: DiscussionContext): Promise<void> {
        console.log(`[DiscussionCoordinator] Starting discussion flow for ${discussion.discussionId}`);
        
        let currentAgentUrl = discussion.participants.agent1Url;
        let targetAgentUrl = discussion.participants.agent2Url;
        
        try {
            // Wait for the initial agent to complete and then continue the flow
            while (this.shouldContinueDiscussion(discussion) && discussion.status === 'active') {
                
                // Check if we've reached max rounds before waiting for response
                if (discussion.currentRound > discussion.maxRounds) {
                    console.log(`[DiscussionCoordinator] Max rounds (${discussion.maxRounds}) reached, ending discussion`);
                    break;
                }
                console.log(`[DiscussionCoordinator] Waiting for response from ${currentAgentUrl} in round ${discussion.currentRound}`);
                
                // Wait for agent response (poll for task completion)
                const agentResponse = await this.waitForAgentResponse(currentAgentUrl, discussion);
                
                if (!agentResponse) {
                    console.log(`[DiscussionCoordinator] No response received from ${currentAgentUrl}, ending discussion`);
                    break;
                }
                
                // Double-check if we should still continue after getting the response
                if (!this.shouldContinueDiscussion(discussion)) {
                    console.log(`[DiscussionCoordinator] Discussion should not continue after receiving response, ending now`);
                    break;
                }

                console.log(`[DiscussionCoordinator] Received response from ${currentAgentUrl}, forwarding to ${targetAgentUrl}`);
                
                // IMPORTANT: Add the agent's actual response to message history
                discussion.messageHistory.push(agentResponse as DiscussionMessage);
                
                // Prepare message for the other agent
                const discussionMessage = this.createNextRoundMessage(
                    agentResponse,
                    discussion,
                    targetAgentUrl,
                    currentAgentUrl === discussion.participants.agent1Url ? 'initiator' : 'responder'
                );
                
                // Send to the other agent
                try {
                    await this.sendMessageToAgent(targetAgentUrl, discussionMessage);
                } catch (error) {
                    console.warn(`[DiscussionCoordinator] Cannot reach ${targetAgentUrl}, likely agent was cleaned up. Ending discussion gracefully.`);
                    break; // End discussion gracefully when agent is unavailable
                }
                
                // Update discussion state
                discussion.messageHistory.push(discussionMessage);
                discussion.currentRound++;
                discussion.lastActivity = new Date();
                
                this.emitEvent({ 
                    type: 'message_sent', 
                    data: { 
                        from: currentAgentUrl, 
                        to: targetAgentUrl, 
                        message: discussionMessage,
                        round: discussion.currentRound - 1
                    } 
                });

                // Swap agents for next round
                [currentAgentUrl, targetAgentUrl] = [targetAgentUrl, currentAgentUrl];
                
                // Brief pause between rounds
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            
            console.log(`[DiscussionCoordinator] Discussion flow completed for ${discussion.discussionId}`);
            
            // Conclude discussion
            await this.concludeDiscussion(discussion.discussionId);
            
        } catch (error) {
            console.error(`[DiscussionCoordinator] Error in discussion flow:`, error);
            discussion.status = 'error';
            this.emitEvent({ 
                type: 'discussion_error', 
                data: { error: error.message, contextId: discussion.contextId } 
            });
        }
    }

    /**
     * Wait for agent response by polling task status
     */
    private async waitForAgentResponse(
        agentUrl: string, 
        discussion: DiscussionContext,
        maxWaitMs: number = 60000
    ): Promise<Message | null> {
        const startTime = Date.now();
        const pollInterval = 2000; // 2 seconds
        let pollCount = 0;
        
        console.log(`[DiscussionCoordinator] Starting to wait for response from ${agentUrl}, contextId: ${discussion.contextId}`);
        
        while (Date.now() - startTime < maxWaitMs) {
            pollCount++;
            try {
                // Check if we should still continue
                if (!this.shouldContinueDiscussion(discussion)) {
                    console.log(`[DiscussionCoordinator] Discussion should not continue, stopping wait`);
                    return null;
                }
                
                // Additional check for round limit to exit immediately
                if (discussion.currentRound >= discussion.maxRounds) {
                    console.log(`[DiscussionCoordinator] Round limit reached during polling, stopping wait immediately`);
                    return null;
                }
                
                // Poll the agent for task status using A2A endpoint
                const cleanUrl = agentUrl.replace(/\/$/, '');
                // Reduced logging: console.log(`[DiscussionCoordinator] Poll #${pollCount}: GET ${cleanUrl}/a2a/tasks?contextId=${discussion.contextId}`);
                
                const response = await axios.get(`${cleanUrl}/a2a/tasks`, {
                    params: { contextId: discussion.contextId },
                    headers: { 'A2A-Protocol-Version': '0.3.0' },
                    timeout: 5000
                });
                
                // Reduced logging: console.log(`[DiscussionCoordinator] Poll #${pollCount}: Response status ${response.status}, data length: ${response.data?.length || 0}`);
                
                if (response.data && response.data.length > 0) {
                    // Reduced logging: console.log(`[DiscussionCoordinator] Poll #${pollCount}: Found ${response.data.length} tasks`);
                    
                    // Reduced logging: Log all tasks for debugging
                    // response.data.forEach((task: any, index: number) => {
                    //     console.log(`[DiscussionCoordinator] Poll #${pollCount}: Task ${index}: contextId=${task.contextId}, state=${task.status?.state}`);
                    // });
                    
                    // Find completed task for this context (including failed states)
                    const completedTask = response.data.find((task: any) => 
                        task.contextId === discussion.contextId && 
                        (task.status?.state === 'completed' || task.status?.state === 'input-required' || task.status?.state === 'failed')
                    );
                    
                    if (completedTask && completedTask.status?.message) {
                        console.log(`[DiscussionCoordinator] Found completed task from ${agentUrl}, state: ${completedTask.status.state}`);
                        return completedTask.status.message;
                    } else if (completedTask) {
                        console.log(`[DiscussionCoordinator] Found task but no message content`);
                    }
                }
                
            } catch (error) {
                console.warn(`[DiscussionCoordinator] Error polling ${agentUrl} (poll #${pollCount}):`, error.message);
            }
            
            // Wait before next poll
            await new Promise(resolve => setTimeout(resolve, pollInterval));
        }
        
        console.warn(`[DiscussionCoordinator] Timeout waiting for response from ${agentUrl} after ${pollCount} polls`);
        return null;
    }

    /**
     * Create message for next round based on agent response
     */
    private createNextRoundMessage(
        agentResponse: Message,
        discussion: DiscussionContext,
        targetAgentUrl: string,
        senderRole: string
    ): DiscussionMessage {
        return {
            kind: 'message',
            role: 'user',
            messageId: uuidv4(),
            contextId: discussion.contextId,
            parts: agentResponse.parts,
            metadata: {
                discussionMode: true,
                discussionRound: discussion.currentRound + 1,
                targetAgentUrl,
                originalTopic: discussion.topic,
                participantRole: senderRole === 'initiator' ? 'responder' : 'initiator',
                conversationType: 'bilateral_discussion',
                previousMessageId: agentResponse.messageId
            }
        };
    }
}