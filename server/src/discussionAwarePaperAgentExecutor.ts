import { v4 as uuidv4 } from 'uuid';
import {
    AgentExecutor,
    RequestContext,
    ExecutionEventBus,
} from '@a2a-js/sdk/server';
import {
    Task,
    TaskStatusUpdateEvent,
    TextPart,
    Message,
} from '@a2a-js/sdk';
import { enhancedSearch, SearchOptions } from './beamSearchService';
import { PaperAgentConfig } from './types/paperAgent';
import { DiscussionMessage, DiscussionTaskState } from './types/discussion';

/**
 * Discussion-aware PaperAgentExecutor that handles both regular search queries
 * and multi-turn discussion messages in A2A protocol compliant way
 */
export class DiscussionAwarePaperAgentExecutor implements AgentExecutor {
    private cancelledTasks = new Set<string>();
    private paperConfig: PaperAgentConfig;
    private conversationHistory: Message[] = [];
    private discussionContexts: Map<string, DiscussionMessage[]> = new Map();

    constructor(config: PaperAgentConfig) {
        this.paperConfig = config;
        console.log(`[DiscussionAwarePaperAgentExecutor] Initialized for paper: ${config.paperTitle || config.treeId}`);
    }

    public cancelTask = async (
        taskId: string,
        eventBus: ExecutionEventBus,
    ): Promise<void> => {
        console.log(`[DiscussionAwarePaperAgentExecutor] Cancelling task ${taskId}`);
        this.cancelledTasks.add(taskId);
    };

    async execute(
        requestContext: RequestContext,
        eventBus: ExecutionEventBus
    ): Promise<void> {
        const userMessage = requestContext.userMessage;
        const existingTask = requestContext.task;

        // Determine IDs for the task and context
        const taskId = existingTask?.id || uuidv4();
        const contextId = userMessage.contextId || existingTask?.contextId || uuidv4();

        console.log(
            `[DiscussionAwarePaperAgentExecutor] Processing message ${userMessage.messageId} for paper "${this.paperConfig.paperTitle}"`
        );

        // Check if this is a discussion message
        const isDiscussionMessage = userMessage.metadata?.discussionMode === true;
        
        if (isDiscussionMessage) {
            console.log(`[DiscussionAwarePaperAgentExecutor] Handling discussion message in round ${userMessage.metadata.discussionRound}`);
            await this.handleDiscussionMessage(requestContext, eventBus, taskId, contextId);
        } else {
            console.log(`[DiscussionAwarePaperAgentExecutor] Handling regular search message`);
            await this.handleSearchMessage(requestContext, eventBus, taskId, contextId);
        }
    }

    /**
     * Handle discussion-specific messages with A2A protocol compliance
     */
    private async handleDiscussionMessage(
        requestContext: RequestContext,
        eventBus: ExecutionEventBus,
        taskId: string,
        contextId: string
    ): Promise<void> {
        const userMessage = requestContext.userMessage;
        const existingTask = requestContext.task;
        
        // Add to discussion context history
        if (!this.discussionContexts.has(contextId)) {
            this.discussionContexts.set(contextId, []);
        }
        const discussionHistory = this.discussionContexts.get(contextId)!;
        discussionHistory.push(userMessage as DiscussionMessage);

        // 1. Create or update task with discussion metadata
        if (!existingTask) {
            const initialTask: Task = {
                kind: 'task',
                id: taskId,
                contextId: contextId,
                status: {
                    state: DiscussionTaskState.SUBMITTED,
                    timestamp: new Date().toISOString(),
                },
                history: [userMessage],
                metadata: {
                    ...userMessage.metadata,
                    paper_agent: {
                        tree_id: this.paperConfig.treeId,
                        paper_title: this.paperConfig.paperTitle,
                        discussion_mode: true
                    }
                },
            };
            eventBus.publish(initialTask);
        }

        // 2. Publish working status
        const workingStatusUpdate: TaskStatusUpdateEvent = {
            kind: 'status-update',
            taskId: taskId,
            contextId: contextId,
            status: {
                state: DiscussionTaskState.WORKING,
                message: {
                    kind: 'message',
                    role: 'agent',
                    messageId: uuidv4(),
                    parts: [{ 
                        kind: 'text', 
                        text: `Analyzing "${this.paperConfig.paperTitle}" to contribute to the discussion...` 
                    }],
                    taskId: taskId,
                    contextId: contextId,
                },
                timestamp: new Date().toISOString(),
            },
            final: false,
        };
        eventBus.publish(workingStatusUpdate);

        try {
            // Check for cancellation
            if (this.cancelledTasks.has(taskId)) {
                console.log(`[DiscussionAwarePaperAgentExecutor] Request cancelled for task: ${taskId}`);
                const cancelledUpdate: TaskStatusUpdateEvent = {
                    kind: 'status-update',
                    taskId: taskId,
                    contextId: contextId,
                    status: {
                        state: "canceled",
                        timestamp: new Date().toISOString(),
                    },
                    final: true,
                };
                eventBus.publish(cancelledUpdate);
                return;
            }

            // 3. Extract question and enhance with discussion context
            const textParts = userMessage.parts.filter((p): p is TextPart => p.kind === 'text');
            if (textParts.length === 0) {
                throw new Error('No text content found in discussion message');
            }

            const originalQuestion = textParts[0].text;
            const enhancedQuestion = this.enhanceQuestionWithDiscussionContext(
                originalQuestion,
                discussionHistory,
                userMessage.metadata
            );

            console.log(`[DiscussionAwarePaperAgentExecutor] Original: "${originalQuestion}"`);
            console.log(`[DiscussionAwarePaperAgentExecutor] Enhanced: "${enhancedQuestion}"`);

            // 4. Perform contextual search
            console.log(`[DiscussionAwarePaperAgentExecutor] Preparing search options...`);
            const searchOptions = this.prepareDiscussionSearchOptions(userMessage.metadata);
            console.log(`[DiscussionAwarePaperAgentExecutor] Search options prepared:`, searchOptions);
            
            const host = this.paperConfig.host || 'https://treer.ai';
            console.log(`[DiscussionAwarePaperAgentExecutor] Starting enhancedSearch with:`);
            console.log(`  Question: "${enhancedQuestion}"`);
            console.log(`  TreeID: ${this.paperConfig.treeId}`);
            console.log(`  Host: ${host}`);
            
            const searchResult = await enhancedSearch(
                enhancedQuestion,
                this.paperConfig.treeId,
                host,
                searchOptions
            );

            console.log(`[DiscussionAwarePaperAgentExecutor] Search completed in ${searchResult.processing_time_ms}ms`);

            // 5. Generate discussion-specific response
            const discussionResponse = this.formatDiscussionResponse(
                searchResult,
                originalQuestion,
                userMessage.metadata,
                discussionHistory.length
            );

            // 6. Create agent response message
            const agentMessage: Message = {
                kind: 'message',
                role: 'agent',
                messageId: uuidv4(),
                parts: [{ kind: 'text', text: discussionResponse }],
                taskId: taskId,
                contextId: contextId,
                metadata: {
                    confidence: searchResult.confidence,
                    processing_time_ms: searchResult.processing_time_ms,
                    matched_nodes_count: searchResult.matched_nodes.length,
                    discussion_mode: true,
                    discussion_round: userMessage.metadata.discussionRound,
                    paper_agent: {
                        tree_id: this.paperConfig.treeId,
                        paper_title: this.paperConfig.paperTitle,
                        participant_role: this.getOppositeRole(userMessage.metadata.participantRole)
                    },
                    ...(searchResult.metadata && { search_stats: searchResult.metadata })
                }
            };

            // Add to discussion history
            discussionHistory.push(agentMessage as DiscussionMessage);

            // 7. Publish completed status - task is done from this agent's perspective
            const finalUpdate: TaskStatusUpdateEvent = {
                kind: 'status-update',
                taskId: taskId,
                contextId: contextId,
                status: {
                    state: "completed", // Agent has completed its part of the discussion
                    message: agentMessage,
                    timestamp: new Date().toISOString(),
                },
                final: true,
            };
            eventBus.publish(finalUpdate);

            console.log(
                `[DiscussionAwarePaperAgentExecutor] Discussion task ${taskId} completed, waiting for next round`
            );

        } catch (error: any) {
            console.error(
                `[DiscussionAwarePaperAgentExecutor] Error in discussion task ${taskId}:`,
                error
            );
            
            const errorUpdate: TaskStatusUpdateEvent = {
                kind: 'status-update',
                taskId: taskId,
                contextId: contextId,
                status: {
                    state: DiscussionTaskState.FAILED,
                    message: {
                        kind: 'message',
                        role: 'agent',
                        messageId: uuidv4(),
                        parts: [{ 
                            kind: 'text', 
                            text: `I encountered an error while preparing my response: ${error.message}` 
                        }],
                        taskId: taskId,
                        contextId: contextId,
                    },
                    timestamp: new Date().toISOString(),
                },
                final: true,
            };
            eventBus.publish(errorUpdate);
        } finally {
            this.cancelledTasks.delete(taskId);
        }
    }

    /**
     * Handle regular search messages (fallback to original behavior)
     */
    private async handleSearchMessage(
        requestContext: RequestContext,
        eventBus: ExecutionEventBus,
        taskId: string,
        contextId: string
    ): Promise<void> {
        // Use the original PaperAgentExecutor logic for regular searches
        // This maintains backward compatibility
        
        const userMessage = requestContext.userMessage;
        const existingTask = requestContext.task;

        if (!existingTask) {
            const initialTask: Task = {
                kind: 'task',
                id: taskId,
                contextId: contextId,
                status: {
                    state: "submitted",
                    timestamp: new Date().toISOString(),
                },
                history: [userMessage],
                metadata: {
                    ...userMessage.metadata,
                    paper_agent: {
                        tree_id: this.paperConfig.treeId,
                        paper_title: this.paperConfig.paperTitle
                    }
                },
            };
            eventBus.publish(initialTask);
        }

        // Continue with standard search logic...
        console.log(`[DiscussionAwarePaperAgentExecutor] Processing regular search for: ${this.paperConfig.paperTitle}`);
        
        try {
            // Update task status to working
            const workingUpdate: TaskStatusUpdateEvent = {
                taskId: taskId,
                status: {
                    state: "working",
                    message: {
                        kind: 'message',
                        role: 'agent',
                        messageId: uuidv4(),
                        parts: [{
                            kind: 'text',
                            text: `Searching "${this.paperConfig.paperTitle}" for information about your query...`
                        }],
                        taskId: taskId,
                        contextId: contextId
                    },
                    timestamp: new Date().toISOString()
                }
            };
            eventBus.publish(workingUpdate);
            
            // Extract question from user message
            const question = userMessage.parts[0]?.text || 'General information';
            console.log(`[DiscussionAwarePaperAgentExecutor] Search question: "${question}"`);
            
            // Perform the search
            const host = this.paperConfig.host || 'https://treer.ai';
            console.log(`[DiscussionAwarePaperAgentExecutor] Starting search with host: ${host}`);
            
            const searchResult = await enhancedSearch(
                question,
                this.paperConfig.treeId,
                host,
                { max_nodes: 10 }
            );
            
            console.log(`[DiscussionAwarePaperAgentExecutor] Search completed, found ${searchResult.matched_nodes.length} nodes`);
            
            // Create final response
            const response: TextPart = {
                kind: 'text',
                text: searchResult.answer
            };
            
            // Update task with final result
            const completedUpdate: TaskStatusUpdateEvent = {
                kind: 'status-update',
                taskId: taskId,
                contextId: contextId,
                status: {
                    state: "completed",
                    message: {
                        kind: 'message',
                        role: 'agent',
                        messageId: uuidv4(),
                        parts: [response],
                        taskId: taskId,
                        contextId: contextId,
                        metadata: {
                            confidence: searchResult.confidence,
                            processing_time_ms: searchResult.processing_time_ms,
                            matched_nodes_count: searchResult.matched_nodes.length,
                            paper_agent: {
                                tree_id: this.paperConfig.treeId,
                                paper_title: this.paperConfig.paperTitle
                            }
                        }
                    },
                    timestamp: new Date().toISOString()
                },
                final: true
            };
            eventBus.publish(completedUpdate);
            
        } catch (error) {
            console.error(`[DiscussionAwarePaperAgentExecutor] Search error:`, error);
            
            // Update task with error
            const errorUpdate: TaskStatusUpdateEvent = {
                kind: 'status-update',
                taskId: taskId,
                contextId: contextId,
                status: {
                    state: "failed",
                    message: {
                        kind: 'message',
                        role: 'agent',
                        messageId: uuidv4(),
                        parts: [{
                            kind: 'text',
                            text: `Error occurred during search: ${error.message}`
                        }],
                        taskId: taskId,
                        contextId: contextId
                    },
                    timestamp: new Date().toISOString()
                },
                final: true
            };
            eventBus.publish(errorUpdate);
        }
    }

    /**
     * Enhance question with discussion context and history
     */
    private enhanceQuestionWithDiscussionContext(
        originalQuestion: string,
        discussionHistory: DiscussionMessage[],
        messageMetadata: any
    ): string {
        let enhancedQuestion = originalQuestion;

        // Add context about the discussion topic
        if (messageMetadata.originalTopic && messageMetadata.originalTopic !== originalQuestion) {
            enhancedQuestion = `In the context of discussing "${messageMetadata.originalTopic}", ${originalQuestion}`;
        }

        // Add paper perspective
        enhancedQuestion += ` Please respond from the perspective of the research presented in "${this.paperConfig.paperTitle}".`;

        // Add discussion round context
        if (messageMetadata.discussionRound > 1) {
            enhancedQuestion += ` This is round ${messageMetadata.discussionRound} of our discussion.`;
        }

        // Reference previous discussion if available
        if (discussionHistory.length > 1) {
            const recentAgentMessages = discussionHistory
                .filter(msg => msg.role === 'agent')
                .slice(-2)
                .map(msg => msg.parts[0]?.text?.slice(0, 100))
                .filter(text => text);
            
            if (recentAgentMessages.length > 0) {
                enhancedQuestion += ` Consider our previous discussion points: ${recentAgentMessages.join('; ')}`;
            }
        }

        return enhancedQuestion;
    }

    /**
     * Prepare search options optimized for discussion context
     */
    private prepareDiscussionSearchOptions(messageMetadata: any): SearchOptions {
        return {
            max_nodes: Math.min(messageMetadata.discussionRound * 5, 20), // More nodes for later rounds
            include_metadata: true,
            confidence_threshold: 0.1
        };
    }

    /**
     * Format response specifically for discussion context
     */
    private formatDiscussionResponse(
        searchResult: any,
        originalQuestion: string,
        messageMetadata: any,
        discussionLength: number
    ): string {
        let response = `**From "${this.paperConfig.paperTitle}":**\n\n`;
        
        // Add round indicator
        if (messageMetadata.discussionRound > 1) {
            response += `*Round ${messageMetadata.discussionRound} response:*\n\n`;
        }

        // Main response content
        response += searchResult.answer;

        // Add discussion-specific context
        if (discussionLength > 2) {
            response += `\n\n*Building on our ongoing discussion, I believe this perspective from my research adds valuable insight to the topic.*`;
        }

        // Add confidence and processing info for transparency
        response += `\n\n---\n*Response confidence: ${Math.round(searchResult.confidence * 100)}% | Based on ${searchResult.matched_nodes.length} relevant sections*`;

        return response;
    }

    /**
     * Get opposite role for response metadata
     */
    private getOppositeRole(role: string): string {
        return role === 'initiator' ? 'responder' : 'initiator';
    }

    /**
     * Get discussion history for a context
     */
    getDiscussionHistory(contextId: string): DiscussionMessage[] {
        return this.discussionContexts.get(contextId) || [];
    }

    /**
     * Clear discussion history for a context
     */
    clearDiscussionHistory(contextId: string): void {
        this.discussionContexts.delete(contextId);
        console.log(`[DiscussionAwarePaperAgentExecutor] Cleared discussion history for context ${contextId}`);
    }

    /**
     * Get paper configuration
     */
    getPaperConfig(): PaperAgentConfig {
        return { ...this.paperConfig };
    }
}