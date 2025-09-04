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

/**
 * PaperAgentExecutor is a specialized executor for paper agents
 * It extends the basic search functionality with paper-specific context and capabilities
 */
export class PaperAgentExecutor implements AgentExecutor {
    private cancelledTasks = new Set<string>();
    private paperConfig: PaperAgentConfig;
    private conversationHistory: Message[] = [];

    constructor(config: PaperAgentConfig) {
        this.paperConfig = config;
        console.log(`[PaperAgentExecutor] Initialized for paper: ${config.paperTitle || config.treeId}`);
    }

    public cancelTask = async (
        taskId: string,
        eventBus: ExecutionEventBus,
    ): Promise<void> => {
        console.log(`[PaperAgentExecutor] Cancelling task ${taskId}`);
        this.cancelledTasks.add(taskId);
        // The execute loop is responsible for publishing the final state
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
            `[PaperAgentExecutor] Processing message ${userMessage.messageId} for paper "${this.paperConfig.paperTitle}"`
        );
        console.log(`[PaperAgentExecutor] Task ${taskId}, Context ${contextId}`);

        // Add user message to conversation history
        this.conversationHistory.push(userMessage);

        // 1. Publish initial Task event if it's a new task
        if (!existingTask) {
            const initialTask: Task = {
                kind: 'task',
                id: taskId,
                contextId: contextId,
                status: {
                    state: "submitted",
                    timestamp: new Date().toISOString(),
                },
                history: [userMessage], // Start history with the current user message
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

        // 2. Publish "working" status update
        const workingStatusUpdate: TaskStatusUpdateEvent = {
            kind: 'status-update',
            taskId: taskId,
            contextId: contextId,
            status: {
                state: "working",
                message: {
                    kind: 'message',
                    role: 'agent',
                    messageId: uuidv4(),
                    parts: [{ 
                        kind: 'text', 
                        text: `Analyzing "${this.paperConfig.paperTitle}" to answer your question...` 
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
            // 3. Extract and enhance the search request
            const textParts = userMessage.parts.filter((p): p is TextPart => p.kind === 'text');
            if (textParts.length === 0) {
                throw new Error('No text content found in user message');
            }

            const messageText = textParts[0].text;
            console.log(`[PaperAgentExecutor] Question: "${messageText}"`);

            // Check if the request has been cancelled
            if (this.cancelledTasks.has(taskId)) {
                console.log(`[PaperAgentExecutor] Request cancelled for task: ${taskId}`);
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

            // 4. Prepare enhanced search with paper context
            const searchOptions = this.prepareSearchOptions(messageText, userMessage.metadata);
            const contextualQuestion = this.enhanceQuestionWithContext(messageText);
            
            console.log(`[PaperAgentExecutor] Enhanced question: "${contextualQuestion}"`);
            console.log(`[PaperAgentExecutor] Search options:`, searchOptions);
            
            // 5. Perform the search using pre-configured tree information
            const searchResult = await enhancedSearch(
                contextualQuestion,
                this.paperConfig.treeId,
                this.paperConfig.host || 'https://treer.ai',
                searchOptions
            );
            
            console.log(`[PaperAgentExecutor] Search completed in ${searchResult.processing_time_ms}ms`);
            console.log(`[PaperAgentExecutor] Found ${searchResult.matched_nodes.length} relevant nodes`);

            // 6. Format the paper-specific response
            const responseText = this.formatPaperResponse(
                searchResult, 
                messageText, 
                searchOptions.include_metadata
            );

            // 7. Create agent response message
            const agentMessage: Message = {
                kind: 'message',
                role: 'agent',
                messageId: uuidv4(),
                parts: [{ kind: 'text', text: responseText }],
                taskId: taskId,
                contextId: contextId,
                metadata: {
                    confidence: searchResult.confidence,
                    processing_time_ms: searchResult.processing_time_ms,
                    matched_nodes_count: searchResult.matched_nodes.length,
                    paper_agent: {
                        tree_id: this.paperConfig.treeId,
                        paper_title: this.paperConfig.paperTitle,
                        specialization: 'single_paper_discussion'
                    },
                    ...(searchResult.metadata && { search_stats: searchResult.metadata })
                }
            };

            // Add agent response to conversation history
            this.conversationHistory.push(agentMessage);

            // 8. Publish final task status update
            const finalUpdate: TaskStatusUpdateEvent = {
                kind: 'status-update',
                taskId: taskId,
                contextId: contextId,
                status: {
                    state: "completed",
                    message: agentMessage,
                    timestamp: new Date().toISOString(),
                },
                final: true,
            };
            eventBus.publish(finalUpdate);

            console.log(
                `[PaperAgentExecutor] Task ${taskId} completed successfully with confidence ${searchResult.confidence}`
            );

        } catch (error: any) {
            console.error(
                `[PaperAgentExecutor] Error processing task ${taskId}:`,
                error
            );
            
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
                            text: `I encountered an error while searching "${this.paperConfig.paperTitle}": ${error.message}` 
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
            // Clean up cancelled task tracking
            this.cancelledTasks.delete(taskId);
        }
    }

    /**
     * Prepare search options based on message content and metadata
     */
    private prepareSearchOptions(messageText: string, metadata?: Record<string, any>): SearchOptions {
        // Default options for paper agents
        const baseOptions: SearchOptions = {
            max_nodes: this.paperConfig.maxNodes || 10,
            include_metadata: false,
            confidence_threshold: 0.1
        };

        // Override with metadata if provided
        if (metadata?.search_options) {
            return { ...baseOptions, ...metadata.search_options };
        }

        // Adjust based on question type
        if (this.isDetailedInquiry(messageText)) {
            baseOptions.max_nodes = Math.min((baseOptions.max_nodes || 10) * 1.5, 20);
            baseOptions.include_metadata = true;
        }

        if (this.isComparisonQuestion(messageText)) {
            baseOptions.max_nodes = Math.min((baseOptions.max_nodes || 10) * 2, 25);
        }

        return baseOptions;
    }

    /**
     * Enhance the question with conversational context and paper specificity
     */
    private enhanceQuestionWithContext(question: string): string {
        // Add paper context
        let enhancedQuestion = question;

        // If this is part of a conversation, add context
        if (this.conversationHistory.length > 1) {
            const recentMessages = this.conversationHistory
                .slice(-3) // Last 3 messages for context
                .filter(msg => msg.role === 'user')
                .map(msg => msg.parts.find(p => p.kind === 'text')?.text)
                .filter(text => text && text !== question);

            if (recentMessages.length > 0) {
                enhancedQuestion = `Given our previous discussion about ${recentMessages.join(', ')}, ${question}`;
            }
        }

        return enhancedQuestion;
    }

    /**
     * Format the response in a paper-agent specific way
     */
    private formatPaperResponse(
        searchResult: any,
        originalQuestion: string,
        includeMetadata: boolean
    ): string {
        let response = searchResult.answer;

        // Add paper-specific context to the beginning
        const paperContext = `*Based on "${this.paperConfig.paperTitle}":*\n\n`;
        response = paperContext + response;

        // Add metadata if requested
        if (includeMetadata && searchResult.metadata) {
            response += `\n\n**Search Analysis:**\n`;
            response += `- Confidence: ${Math.round(searchResult.confidence * 100)}%\n`;
            response += `- Processing time: ${searchResult.processing_time_ms}ms\n`;
            response += `- Sections analyzed: ${searchResult.matched_nodes.length}\n`;
            response += `- Nodes evaluated: ${searchResult.metadata.nodes_evaluated}`;
        }

        // Add conversation context note if this is part of an ongoing discussion
        if (this.conversationHistory.length > 2) {
            response += `\n\n*This response builds on our ongoing discussion about this paper.*`;
        }

        return response;
    }

    /**
     * Check if the question requires detailed analysis
     */
    private isDetailedInquiry(question: string): boolean {
        const detailKeywords = [
            'methodology', 'method', 'approach', 'technique', 'analysis',
            'experiment', 'study', 'research', 'detailed', 'comprehensive',
            'explain', 'describe', 'how', 'why'
        ];
        const lowerQuestion = question.toLowerCase();
        return detailKeywords.some(keyword => lowerQuestion.includes(keyword));
    }

    /**
     * Check if the question is asking for comparisons
     */
    private isComparisonQuestion(question: string): boolean {
        const comparisonKeywords = [
            'compare', 'comparison', 'versus', 'vs', 'difference', 'similar',
            'contrast', 'unlike', 'better', 'worse', 'advantage', 'disadvantage'
        ];
        const lowerQuestion = question.toLowerCase();
        return comparisonKeywords.some(keyword => lowerQuestion.includes(keyword));
    }

    /**
     * Get current conversation history
     */
    getConversationHistory(): Message[] {
        return [...this.conversationHistory];
    }

    /**
     * Clear conversation history (useful for starting fresh discussions)
     */
    clearConversationHistory(): void {
        this.conversationHistory = [];
        console.log(`[PaperAgentExecutor] Conversation history cleared for paper "${this.paperConfig.paperTitle}"`);
    }

    /**
     * Get paper configuration
     */
    getPaperConfig(): PaperAgentConfig {
        return { ...this.paperConfig };
    }
}