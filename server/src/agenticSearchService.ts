import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import { NodeM, TreeM } from "./schema";
import TurndownService from 'turndown';
import showdown from "showdown";
import { getChatModelConfig } from './config';

// Types for the agentic search system
export interface AgenticSearchResult {
    answer: string;
    matched_nodes: MatchedNode[];
    confidence: number;
    processing_time_ms: number;
    metadata?: {
        nodes_explored: number;
        tool_calls: number;
        search_iterations: number;
    };
}

export interface MatchedNode {
    id: string;
    title: string;
    content: string;
    relevance_score: number;
    node_type: string;
}

export interface AgenticSearchOptions {
    max_iterations?: number;
    max_nodes?: number;
    include_metadata?: boolean;
}

// Helper function to extract node content
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

// Helper function to get node title
function getNodeTitle(node: NodeM): string {
    return node.title() || "Untitled";
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

// Create the agentic search system
export async function agenticSearch(
    question: string,
    treeId: string,
    host: string = 'http://0.0.0.0:29999',
    options: AgenticSearchOptions = {}
): Promise<AgenticSearchResult> {
    const startTime = Date.now();
    const stats = {
        nodes_explored: 0,
        tool_calls: 0,
        search_iterations: 0
    };

    const maxIterations = options.max_iterations || 10;
    let tree: TreeM | null = null;

    try {
        // Connect to the tree
        const wsHost = host.replace("http", "ws");
        console.log(`[agenticSearch] Connecting to tree ${treeId} at ${wsHost}...`);

        const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error(`Tree connection timeout after 60 seconds`)), 60000);
        });

        tree = await Promise.race([
            TreeM.treeFromWsWait(wsHost, treeId),
            timeoutPromise
        ]);

        if (!tree) {
            throw new Error(`Failed to connect to tree ${treeId}`);
        }

        const root = tree.getRoot();
        if (!root) {
            throw new Error(`Tree has no root node`);
        }

        console.log(`[agenticSearch] Connected to tree, root: ${root.id}`);

        // Track nodes and exploration state
        const nodeCache = new Map<string, NodeM>();
        const relevantNodeIds = new Set<string>();
        const exploredNodeIds = new Set<string>();

        // Cache all nodes as we encounter them
        const cacheNode = (node: NodeM) => {
            nodeCache.set(node.id, node);
        };

        // Initialize with root
        cacheNode(root);
        const rootChildren = getChildren(tree, root);
        rootChildren.forEach(cacheNode);

        // Build initial context about root's children
        const rootChildrenInfo = rootChildren.map(child => ({
            id: child.id,
            title: getNodeTitle(child),
            preview: getNodeContent(child).slice(0, 200)
        }));

        console.log(`[agenticSearch] Root has ${rootChildren.length} children`);

        // Define tools for the agent
        const tools = {
            getNodeChildren: {
                description: 'Get the children of a node by its ID. Returns an array of child nodes with their IDs, titles, and content previews. Use this to explore deeper into the tree.',
                parameters: z.object({
                    nodeId: z.string().describe('The ID of the node whose children you want to retrieve'),
                }),
                execute: async ({ nodeId }: { nodeId: string }) => {
                    stats.tool_calls++;
                    const node = nodeCache.get(nodeId);
                    if (!node) {
                        return { error: `Node ${nodeId} not found in cache` };
                    }

                    const children = getChildren(tree!, node);
                    children.forEach(cacheNode);

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
            },

            getNodeContent: {
                description: 'Get the full content of a specific node by its ID. Use this when you want to examine a node in detail to determine if it contains the answer.',
                parameters: z.object({
                    nodeId: z.string().describe('The ID of the node whose content you want to retrieve'),
                }),
                execute: async ({ nodeId }: { nodeId: string }) => {
                    stats.tool_calls++;
                    const node = nodeCache.get(nodeId);
                    if (!node) {
                        return { error: `Node ${nodeId} not found in cache` };
                    }

                    stats.nodes_explored++;
                    exploredNodeIds.add(nodeId);

                    return {
                        nodeId,
                        title: getNodeTitle(node),
                        content: getNodeContent(node),
                        nodeType: node.nodeTypeName() || "unknown"
                    };
                },
            },

            markNodeRelevant: {
                description: 'Mark a node as relevant to answering the question. Use this when you find a node that contains useful information for answering the query. You can mark multiple nodes as relevant.',
                parameters: z.object({
                    nodeId: z.string().describe('The ID of the node to mark as relevant'),
                    reason: z.string().describe('Brief explanation of why this node is relevant'),
                }),
                execute: async ({ nodeId, reason }: { nodeId: string; reason: string }) => {
                    stats.tool_calls++;
                    const node = nodeCache.get(nodeId);
                    if (!node) {
                        return { error: `Node ${nodeId} not found` };
                    }

                    relevantNodeIds.add(nodeId);
                    console.log(`[agenticSearch] Marked node ${nodeId} as relevant: ${reason}`);

                    return {
                        success: true,
                        nodeId,
                        title: getNodeTitle(node),
                        totalRelevantNodes: relevantNodeIds.size
                    };
                },
            },

            getParentNode: {
                description: 'Get the parent node of a given node by its ID. Use this to navigate up the tree if needed.',
                parameters: z.object({
                    nodeId: z.string().describe('The ID of the node whose parent you want to find'),
                }),
                execute: async ({ nodeId }: { nodeId: string }) => {
                    stats.tool_calls++;
                    const node = nodeCache.get(nodeId);
                    if (!node) {
                        return { error: `Node ${nodeId} not found` };
                    }

                    try {
                        const parent = tree!.getParent(node);
                        if (parent) {
                            cacheNode(parent);
                            return {
                                nodeId: parent.id,
                                title: getNodeTitle(parent),
                                preview: getNodeContent(parent).slice(0, 200)
                            };
                        } else {
                            return { error: 'No parent found (might be root)' };
                        }
                    } catch (error) {
                        return { error: `Error getting parent: ${error.message}` };
                    }
                },
            },

            generateAnswer: {
                description: 'Generate the final answer based on the nodes you have marked as relevant. Use this when you have gathered enough information to answer the question. This will end the search.',
                parameters: z.object({
                    reasoning: z.string().describe('Brief explanation of how the relevant nodes answer the question'),
                }),
                execute: async ({ reasoning }: { reasoning: string }) => {
                    stats.tool_calls++;
                    console.log(`[agenticSearch] Generating final answer. Reasoning: ${reasoning}`);
                    return {
                        success: true,
                        relevantNodeCount: relevantNodeIds.size,
                        message: 'Answer generation initiated'
                    };
                },
            },
        } as any

        // Create the agent prompt
        const systemPrompt = `You are a tree exploration agent designed to answer questions by intelligently navigating a hierarchical knowledge tree.

QUESTION TO ANSWER: "${question}"

TREE STRUCTURE:
- Root Node ID: ${root.id}
- Root has ${rootChildren.length} children:
${rootChildrenInfo.map(child => `  - [${child.id}] ${child.title}\n    Preview: ${child.preview}...`).join('\n')}

YOUR TASK:
1. Explore the tree strategically to find nodes that help answer the question
2. Use getNodeChildren to explore promising branches
3. Use getNodeContent to examine nodes in detail
4. Use markNodeRelevant to flag nodes that contain useful information
5. Continue exploring until you have enough information
6. Use generateAnswer when you're ready to provide the final answer

STRATEGY:
- Start by exploring the most promising root children based on their titles/previews
- Go deeper into branches that seem relevant
- Don't explore exhaustively - focus on quality over quantity
- Mark nodes as relevant as soon as you find useful information
- You can explore multiple branches if needed
- When you have 2-5 relevant nodes with good information, you can generate the answer

IMPORTANT:
- Be strategic and efficient in your exploration
- Don't just mark everything as relevant - be selective
- Always provide reasoning when marking nodes relevant
- Call generateAnswer when you have sufficient information to answer the question`;

        console.log(`[agenticSearch] Starting agent exploration...`);

        // Run the agent
        const result = await generateText({
            model: openai('gpt-4o'),
            tools,
            system: systemPrompt,
            prompt: `Begin exploring the tree to answer the question: "${question}". Start by examining the root's children and then explore the most promising branches.`,
            //maxSteps: maxIterations,
        });

        stats.search_iterations = result.steps.length;

        console.log(`[agenticSearch] Agent completed with ${result.steps.length} steps`);
        console.log(`[agenticSearch] Found ${relevantNodeIds.size} relevant nodes`);

        // Generate the final answer from relevant nodes
        let answer = "No relevant information found.";
        let confidence = 0.0;
        const treeUrl = new URL(`?id=${treeId}`, host).toString();

        const relevantNodes = Array.from(relevantNodeIds)
            .map(id => nodeCache.get(id))
            .filter((node): node is NodeM => node !== undefined);

        if (relevantNodes.length > 0) {
            const nodesToProcess = options.max_nodes
                ? relevantNodes.slice(0, options.max_nodes)
                : relevantNodes;

            console.log(`[agenticSearch] Generating answer from ${nodesToProcess.length} nodes...`);
            answer = await generateAnswerFromNodes(nodesToProcess, question, treeUrl);
            confidence = calculateConfidence(nodesToProcess);
        }

        // Build matched nodes response
        const matchedNodes: MatchedNode[] = relevantNodes.map((node, index) => ({
            id: node.id,
            title: getNodeTitle(node),
            content: getNodeContent(node).slice(0, 300),
            relevance_score: Math.round((1 - index * 0.1) * 100) / 100,
            node_type: node.nodeTypeName() || "unknown"
        }));

        const searchResult: AgenticSearchResult = {
            answer,
            matched_nodes: matchedNodes,
            confidence,
            processing_time_ms: Date.now() - startTime
        };

        if (options.include_metadata) {
            searchResult.metadata = stats;
        }

        return searchResult;

    } catch (error) {
        console.error("[agenticSearch] Error during agentic search:", error);
        return {
            answer: `Error occurred during search: ${error.message}`,
            matched_nodes: [],
            confidence: 0.0,
            processing_time_ms: Date.now() - startTime,
            metadata: options.include_metadata ? stats : undefined
        };
    } finally {

    }
}

// Generate answer from relevant nodes with references
async function generateAnswerFromNodes(
    nodes: NodeM[],
    question: string,
    treeUrl: string
): Promise<string> {
    const docToPrompt = nodes.map((node, index) => {
        const title = getNodeTitle(node);
        const content = getNodeContent(node);
        return `${index}: ${title}\n${content}`;
    }).join("\n\n");

    try {
        const result = await generateText({
            model: openai('gpt-4o'),
            prompt: `You are required to answer the question based on the following document.

Document:
${docToPrompt}

Question:
${question}

Answer in markdown directly without any formatting.
In your answer, whenever you want to make a statement, insert reference tags <ref id="index"/> where index is the number of the document section you're referencing.`,
        });

        const markdownAnswer = result.text;

        // Convert markdown to HTML
        const converter = new showdown.Converter();
        const htmlAnswer = converter.makeHtml(markdownAnswer);

        // Replace reference tags with links
        const refRegex = /<ref id="(\d+)"\/>/g;
        const htmlAnswerWithRefs = htmlAnswer.replace(refRegex, (match, index) => {
            const idx = parseInt(index);
            const node = nodes[idx];
            if (node) {
                return `<a href="${treeUrl}&n=${node.id}" target="_blank">[ref]</a>`;
            }
            return '[ref]';
        });

        return htmlAnswerWithRefs;
    } catch (error) {
        console.error("[generateAnswerFromNodes] Error generating answer:", error);
        return "Unable to generate answer due to an error.";
    }
}

// Calculate confidence based on node quality
function calculateConfidence(nodes: NodeM[]): number {
    if (nodes.length === 0) return 0.0;

    const baseConfidence = Math.min(nodes.length / 5, 1.0);
    const contentQuality = nodes.filter(node => {
        const content = getNodeContent(node);
        return content && content.length > 50;
    }).length / nodes.length;

    return Math.round((baseConfidence * 0.6 + contentQuality * 0.4) * 100) / 100;
}

// Legacy/convenience function
export async function agenticSearchMain(
    question: string,
    treeId: string,
    host: string = 'http://0.0.0.0:29999'
): Promise<string> {
    const result = await agenticSearch(question, treeId, host);
    return result.answer;
}
