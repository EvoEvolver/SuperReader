import {generateText, tool} from 'ai';
import {openai} from '@ai-sdk/openai';
import {z} from 'zod';
import {NodeM, TreeM} from "./schema";
import showdown from "showdown";

// Helper function to get node title
function getNodeTitle(node: NodeM): string {
    return node.title() || "Untitled";
}

// Helper function to get node content
import TurndownService from 'turndown';

function getNodeContent(node: NodeM): string {
    let nodeTypeName = node.nodeTypeName();
    if (!nodeTypeName) {
        if (node.ymap.get("tabs")["content"] === `<PaperEditorMain/>`) {
            nodeTypeName = "EditorNodeType";
        } else {
            return "Invalid node.";
        }
    }

    if (nodeTypeName === "ReaderNodeType") {
        const data = node.data();
        const htmlContent = data.htmlContent;

        if (!htmlContent || typeof htmlContent !== 'string') {
            return "No content available.";
        }

        const turndownService = new TurndownService();
        try {
            return turndownService.turndown(htmlContent);
        } catch (error) {
            console.warn(`Failed to convert HTML to markdown for node ${node.id}:`, error);
            return "Content processing error.";
        }
    } else if (nodeTypeName === "EditorNodeType") {
        const editorContent = node.ydata().get("ydatapaperEditor").toJSON();
        if (!editorContent || editorContent.trim().length === 0) {
            return "No content.";
        }
        return editorContent;
    }

    return "Unknown node type.";
}

// Helper function to get children safely
function getChildren(tree: TreeM, node: NodeM): NodeM[] {
    try {
        const children = tree.getChildren(node);
        return children ? Array.from(children) : [];
    } catch (error) {
        console.warn(`Error getting children for node ${node.id}:`, error);
        return [];
    }
}

export interface AgenticSearchToolsContext {
    tree: TreeM;
    nodeCache: Map<string, NodeM>;
    relevantNodeIds: Set<string>;
    exploredNodeIds: Set<string>;
    stats: {
        nodes_explored: number;
        tool_calls: number;
        search_iterations: number;
    };
    emitEvent: (event: string, data: any) => void;
    cacheNode: (node: NodeM) => void;
    treeUrl: string;
}

/**
 * Factory function to create agentic search tools with shared context
 */
export function createAgenticSearchTools(context: AgenticSearchToolsContext) {
    const {tree, nodeCache, relevantNodeIds, exploredNodeIds, stats, emitEvent, cacheNode, treeUrl} = context;

    return {
        getNodeChildren: tool({
            description: 'Get the children of a node by its ID. Returns an array of child nodes with their IDs, titles, and content previews. Use this to explore deeper into the tree.',
            inputSchema: z.object({
                nodeId: z.string().describe('The ID of the node whose children you want to retrieve'),
            }),
            execute: async ({nodeId}: { nodeId: string }) => {
                stats.tool_calls++;
                const node = nodeCache.get(nodeId);
                if (!node) {
                    return {error: `Node ${nodeId} not found in cache`};
                }

                const children = getChildren(tree, node);
                children.forEach(cacheNode);

                emitEvent('tool_call', {
                    tool: 'getNodeChildren',
                    nodeId,
                    nodeTitle: getNodeTitle(node),
                    childrenCount: children.length
                });

                return {
                    nodeId,
                    nodeTitle: getNodeTitle(node),
                    children: children.map(child => ({
                        id: child.id,
                        title: getNodeTitle(child),
                        preview: getNodeContent(child).slice(0, 200)
                    }))
                };
            },
        }),

        getNodeContent: tool({
            description: 'Get the full content of a specific node by its ID. Use this when you want to examine a node in detail to determine if it contains the answer.',
            inputSchema: z.object({
                nodeId: z.string().describe('The ID of the node whose content you want to retrieve'),
            }),
            execute: async ({nodeId}: { nodeId: string }) => {
                stats.tool_calls++;
                const node = nodeCache.get(nodeId);
                if (!node) {
                    return {error: `Node ${nodeId} not found in cache`};
                }

                stats.nodes_explored++;
                exploredNodeIds.add(nodeId);

                emitEvent('tool_call', {
                    tool: 'getNodeContent',
                    nodeId,
                    nodeTitle: getNodeTitle(node),
                    contentLength: getNodeContent(node).length
                });

                return {
                    nodeId,
                    title: getNodeTitle(node),
                    content: getNodeContent(node),
                    nodeType: node.nodeTypeName() || "unknown"
                };
            },
        }),

        markNodeRelevant: tool({
            description: 'Mark a node as relevant to answering the question. Use this when you find a node that contains useful information for answering the query. You can mark multiple nodes as relevant.',
            inputSchema: z.object({
                nodeId: z.string().describe('The ID of the node to mark as relevant'),
                reason: z.string().describe('Brief explanation of why this node is relevant'),
            }),
            execute: async ({nodeId, reason}: { nodeId: string; reason: string }) => {
                stats.tool_calls++;
                const node = nodeCache.get(nodeId);
                if (!node) {
                    return {error: `Node ${nodeId} not found`};
                }

                relevantNodeIds.add(nodeId);

                emitEvent('node_marked_relevant', {
                    nodeId,
                    title: getNodeTitle(node),
                    reason,
                    totalRelevantNodes: relevantNodeIds.size
                });

                return {
                    success: true,
                    nodeId,
                    title: getNodeTitle(node),
                    totalRelevantNodes: relevantNodeIds.size
                };
            },
        }),

        getParentNode: tool({
            description: 'Get the parent node of a given node by its ID. Use this to navigate up the tree if needed.',
            inputSchema: z.object({
                nodeId: z.string().describe('The ID of the node whose parent you want to find'),
            }),
            execute: async ({nodeId}: { nodeId: string }) => {
                stats.tool_calls++;
                const node = nodeCache.get(nodeId);
                if (!node) {
                    return {error: `Node ${nodeId} not found`};
                }

                try {
                    const parent = tree.getParent(node);
                    if (parent) {
                        cacheNode(parent);
                        emitEvent('tool_call', {
                            tool: 'getParentNode',
                            nodeId,
                            parentId: parent.id,
                            parentTitle: getNodeTitle(parent)
                        });
                        return {
                            nodeId: parent.id,
                            title: getNodeTitle(parent),
                            preview: getNodeContent(parent).slice(0, 200)
                        };
                    } else {
                        return {error: 'No parent found (might be root)'};
                    }
                } catch (error) {
                    return {error: `Error getting parent: ${error.message}`};
                }
            },
        }),

        analyzeImage: tool({
            description: 'Analyze an image by providing a query and an image URL. Use this to extract information from images, diagrams, charts, or screenshots that may be referenced in the tree nodes.',
            inputSchema: z.object({
                query: z.string().describe('The question or query about the image'),
                imageUrl: z.string().describe('The URL of the image to analyze'),
            }),
            execute: async ({query, imageUrl}: { query: string; imageUrl: string }) => {
                stats.tool_calls++;
                emitEvent('tool_call', {
                    tool: 'analyzeImage',
                    query,
                    imageUrl
                });

                try {
                    const result = await generateText({
                        model: openai('gpt-5'),
                        messages: [
                            {
                                role: 'user',
                                content: [
                                    {
                                        type: 'text',
                                        text: query
                                    },
                                    {
                                        type: 'image',
                                        image: imageUrl
                                    }
                                ]
                            }
                        ]
                    });

                    emitEvent('image_analyzed', {
                        query,
                        imageUrl,
                        responseLength: result.text.length
                    });

                    return {
                        success: true,
                        query,
                        imageUrl,
                        analysis: result.text
                    };
                } catch (error) {
                    console.error('[analyzeImage] Error analyzing image:', error);
                    return {
                        error: `Failed to analyze image: ${error.message}`
                    };
                }
            },
        }),

        generateAnswer: tool({
            description: 'Generate the final answer based on the nodes you have marked as relevant. Use this when you have gathered enough information to answer the question. Write a comprehensive markdown report that answers the user\'s question. In your markdown answer, whenever you want to reference a node, insert reference tags <ref id="nodeId"/> where nodeId is the ID of the node you\'re referencing. This will end the search.',
            inputSchema: z.object({
                markdownReport: z.string().describe('A comprehensive markdown report that answers the question. Use <ref id="nodeId"/> tags to reference specific nodes.'),
            }),
            execute: async ({markdownReport}: { markdownReport: string }) => {
                stats.tool_calls++;

                // Convert markdown to HTML
                const converter = new showdown.Converter();
                const htmlAnswer = converter.makeHtml(markdownReport);

                // Replace reference tags with links
                const refRegex = /<ref id="([^"]+)"\s*\/?>/g;
                const htmlAnswerWithRefs = htmlAnswer.replace(refRegex, (match, nodeId) => {
                    const node = nodeCache.get(nodeId);
                    if (node) {
                        return `<a href="${treeUrl}&n=${nodeId}" target="_blank">[ref]</a>`;
                    }
                    return '[ref]';
                });

                emitEvent('answer', {answer: htmlAnswerWithRefs});
                emitEvent('status', {
                    stage: 'complete',
                    message: `Answer generated successfully with ${relevantNodeIds.size} relevant nodes`
                });

                return {
                    success: true,
                    relevantNodeCount: relevantNodeIds.size,
                    message: 'Answer generation completed'
                };
            },
        }),
    };
}
