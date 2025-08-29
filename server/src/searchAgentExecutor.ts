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

/**
 * SearchAgentExecutor implements the A2A AgentExecutor interface
 * to handle knowledge tree search requests using our existing search logic.
 */
export class SearchAgentExecutor implements AgentExecutor {
    private cancelledTasks = new Set<string>();

    public cancelTask = async (
        taskId: string,
        eventBus: ExecutionEventBus,
    ): Promise<void> => {
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
            `[SearchAgentExecutor] Processing message ${userMessage.messageId} for task ${taskId} (context: ${contextId})`
        );

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
                metadata: userMessage.metadata, // Carry over metadata from message if any
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
                    parts: [{ kind: 'text', text: 'Searching knowledge tree, please wait...' }],
                    taskId: taskId,
                    contextId: contextId,
                },
                timestamp: new Date().toISOString(),
            },
            final: false,
        };
        eventBus.publish(workingStatusUpdate);

        try {
            // 3. Extract search parameters from user message
            const textParts = userMessage.parts.filter((p): p is TextPart => p.kind === 'text');
            if (textParts.length === 0) {
                throw new Error('No text content found in user message');
            }

            console.log(`[SearchAgentExecutor] Message text:`, textParts[0].text);
            console.log(`[SearchAgentExecutor] Message metadata:`, JSON.stringify(userMessage.metadata, null, 2));

            // Parse the search request from the text content
            const searchRequest = this.parseSearchRequest(textParts[0].text, userMessage.metadata);

            // Check if the request has been cancelled
            if (this.cancelledTasks.has(taskId)) {
                console.log(`[SearchAgentExecutor] Request cancelled for task: ${taskId}`);
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

            // 4. Perform the search using our existing enhanced search
            console.log(`[SearchAgentExecutor] Performing search: "${searchRequest.question}"`);
            console.log(`[SearchAgentExecutor] Search parameters:`, {
                treeId: searchRequest.treeId,
                host: searchRequest.host,
                options: searchRequest.options
            });
            
            const searchResult = await enhancedSearch(
                searchRequest.question,
                searchRequest.treeId,
                searchRequest.host,
                searchRequest.options
            );
            
            console.log(`[SearchAgentExecutor] Search completed in ${searchResult.processing_time_ms}ms`);

            // 5. Format the response message
            let responseText = searchResult.answer;
            
            // Add metadata if requested
            if (searchRequest.options.include_metadata && searchResult.metadata) {
                responseText += `\n\n**Search Statistics:**\n`;
                responseText += `- Processing time: ${searchResult.processing_time_ms}ms\n`;
                responseText += `- Confidence: ${Math.round(searchResult.confidence * 100)}%\n`;
                responseText += `- Nodes evaluated: ${searchResult.metadata.nodes_evaluated}\n`;
                responseText += `- Matched nodes: ${searchResult.matched_nodes.length}`;
            }

            // 6. Publish final task status update
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
                    ...(searchResult.metadata && { search_stats: searchResult.metadata })
                }
            };

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
                `[SearchAgentExecutor] Task ${taskId} completed successfully with confidence ${searchResult.confidence}`
            );

        } catch (error: any) {
            console.error(
                `[SearchAgentExecutor] Error processing task ${taskId}:`,
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
                        parts: [{ kind: 'text', text: `Search failed: ${error.message}` }],
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
     * Parse search request from user message text and metadata
     */
    private parseSearchRequest(messageText: string, metadata?: Record<string, any>): {
        question: string;
        treeId: string;
        host: string;
        options: SearchOptions;
    } {
        // Try to extract structured data from metadata first
        if (metadata?.search_request) {
            const req = metadata.search_request;
            const url = new URL(req.tree_url);
            const treeId = url.searchParams.get('id');
            if (!treeId) {
                throw new Error('Missing id parameter in tree_url');
            }
            
            let host = `${url.protocol}//${url.hostname}`;
            if (url.port) {
                host += `:${url.port}`;
            }

            return {
                question: req.question || messageText,
                treeId: treeId,
                host: host,
                options: {
                    max_nodes: req.max_nodes || 10,
                    include_metadata: req.include_metadata || false
                }
            };
        }

        // Fallback: try to parse from message text (for simple cases)
        // Look for any URL in the message text, with or without keywords
        let treeUrl = '';
        
        // First try to find URLs with common keywords
        const keywordLines = messageText.split('\n');
        for (const line of keywordLines) {
            if (line.toLowerCase().includes('tree:') || line.toLowerCase().includes('url:') || line.toLowerCase().includes('located at')) {
                const urlMatch = line.match(/(https?:\/\/[^\s]+)/);
                if (urlMatch) {
                    treeUrl = urlMatch[1];
                    break;
                }
            }
        }
        
        // If not found with keywords, look for any URL pattern in the entire message
        if (!treeUrl) {
            const generalUrlMatch = messageText.match(/(https?:\/\/[^\s]+)/);
            if (generalUrlMatch) {
                treeUrl = generalUrlMatch[1];
            }
        }

        // If still no URL found, try to extract tree ID directly and use default host
        if (!treeUrl) {
            // Look for UUID pattern (tree ID)
            const uuidPattern = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
            const idMatch = messageText.match(uuidPattern);
            
            if (idMatch) {
                const treeId = idMatch[0];
                console.log(`[SearchAgentExecutor] Found tree ID: ${treeId}, using default host: https://treer.ai`);
                
                return {
                    question: messageText.replace(uuidPattern, '').replace(/\b(tree|id|with)\b/gi, '').trim(),
                    treeId: treeId,
                    host: 'https://treer.ai',
                    options: {
                        max_nodes: 10,
                        include_metadata: false
                    }
                };
            }
        }

        if (!treeUrl) {
            throw new Error(`No tree URL or ID found. Please provide either:

URL formats:
- "search query tree: http://localhost:29999/?id=..."
- "search query url: http://localhost:29999/?id=..."  
- "search query located at http://localhost:29999/?id=..."
- "search query http://localhost:29999/?id=..."

ID format:
- "search query with id 3b37b95c-97c7-49cd-89e9-5e103f28f31b" (uses https://treer.ai)

Or provide tree_url in message metadata.`);
        }

        const url = new URL(treeUrl);
        const treeId = url.searchParams.get('id');
        if (!treeId) {
            throw new Error('Missing id parameter in tree_url');
        }
        
        let host = `${url.protocol}//${url.hostname}`;
        if (url.port) {
            host += `:${url.port}`;
        }

        return {
            question: messageText.replace(/https?:\/\/[^\s]+/gi, '').trim(),
            treeId: treeId,
            host: host,
            options: {
                max_nodes: 10,
                include_metadata: false
            }
        };
    }
}