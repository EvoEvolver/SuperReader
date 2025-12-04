import {generateText, tool} from 'ai';
import {openai} from '@ai-sdk/openai';
import {z} from 'zod';
import {NodeM, TreeM} from "../schema";
import showdown from "showdown";

// Helper function to get node title
function getNodeTitle(node: NodeM): string {
    return node.title() || "Untitled";
}

// Helper function to get node content
import TurndownService from 'turndown';



async function relevanceToOLED(content: string, image_url: string): Promise<string[]> {
    const prompt = `
I will provide a figure from a scientific paper.

Your task is to extract OLED-related information from the figure.

Specifically, look for any of the following **properties** in the figure:
- Absorption max (peak absorption wavelength)
- Emission max (peak emission wavelength)
- Lifetime (excited-state lifetime)
- Quantum yield (efficiency of emission)
- log(ε) (log molar extinction coefficient)
- PLQY (photoluminescence quantum yield)
- Any other OLED-related photophysical properties

Extract each piece of information as a separate string. Each string should be a complete, self-contained piece of information (e.g., "Compound A: λabs = 450 nm", "PLQY = 85%", "Lifetime = 5.2 ns").

If the figure contains OLED-related information, extract it line by line.
If the figure is not OLED-related or contains no extractable information, return an empty array.

Output your answer as a JSON object with the key "oled_info" containing an array of strings.
Example: {"oled_info": ["Compound 1: λabs = 450 nm, λem = 520 nm", "PLQY = 85%", "Lifetime = 5.2 ns"]}

Context from the paper: ${content}
`;

    try {
        const result = await generateText({
            model: openai('gpt-4o'),
            messages: [
                {
                    role: 'user',
                    content: [
                        {
                            type: 'text',
                            text: prompt
                        },
                        {
                            type: 'image',
                            image: image_url
                        }
                    ]
                }
            ]
        });

        // Parse the JSON response
        const jsonMatch = result.text.match(/\{[^}]*"oled_info"[^}]*\]/);
        if (jsonMatch) {
            // Find the complete JSON object
            const fullJsonMatch = result.text.match(/\{[^}]*"oled_info"\s*:\s*\[[^\]]*\]\s*\}/);
            if (fullJsonMatch) {
                const parsed = JSON.parse(fullJsonMatch[0]);
                return Array.isArray(parsed.oled_info) ? parsed.oled_info : [];
            }
        }

        // If no valid JSON found, log warning and return empty array
        console.warn('[relevanceToOLED] Could not parse JSON response:', result.text);
        return [];
    } catch (error) {
        console.error('[relevanceToOLED] Error analyzing image for OLED relevance:', error);
        return [];
    }
}

async function getNodeContent(node: NodeM): Promise<string> {
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
        let htmlContent = data.htmlContent;

        if (!htmlContent || typeof htmlContent !== 'string') {
            return "No content available.";
        }

        // Parse HTML content to find image URLs
        const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
        const imageMatches: Array<{url: string, fullTag: string}> = [];
        let match;
        while ((match = imgRegex.exec(htmlContent)) !== null) {
            imageMatches.push({
                url: match[1],
                fullTag: match[0]
            });
        }

        // Log image URLs to console if found
        if (imageMatches.length > 0) {
            console.log(`[Node ${node.id}] Found ${imageMatches.length} image(s):`);

            // Get text context for OLED analysis
            const turndownService = new TurndownService();
            const textContext = turndownService.turndown(htmlContent).slice(0, 1000);

            // Process each image for OLED relevance
            for (let i = 0; i < imageMatches.length; i++) {
                const {url, fullTag} = imageMatches[i];
                console.log(`  Image ${i + 1}: ${url}`);

                try {
                    const oledInfo = await relevanceToOLED(textContext, url);

                    if (oledInfo.length > 0) {
                        // Replace image tag with extracted OLED information
                        const replacementText = `\n<div class="oled-extracted-info">\n<p><strong>OLED Information extracted from image:</strong></p>\n<ul>\n${oledInfo.map(info => `<li>${info}</li>`).join('\n')}\n</ul>\n</div>\n`;
                        htmlContent = htmlContent.replace(fullTag, replacementText);
                        console.log(`  [Node ${node.id}] Replaced image ${i + 1} with ${oledInfo.length} extracted OLED properties`);
                    } else {
                        console.log(`  [Node ${node.id}] Image ${i + 1} contains no relevant OLED information`);
                    }
                } catch (error) {
                    console.error(`  [Node ${node.id}] Error processing image ${i + 1}:`, error);
                }
            }
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

                // Get previews for all children
                const childrenWithPreviews = await Promise.all(
                    children.map(async (child) => ({
                        id: child.id,
                        title: getNodeTitle(child),
                        preview: (await getNodeContent(child)).slice(0, 200)
                    }))
                );

                return {
                    nodeId,
                    nodeTitle: getNodeTitle(node),
                    children: childrenWithPreviews
                };
            },
        }),

        getNodeContent: tool({
            description: 'Get the full content of a specific node by its ID, along with its children. Returns the node content and a list of child nodes with their IDs and titles. Use this when you want to examine a node in detail and see what children it has.',
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

                // Get children
                const children = getChildren(tree, node);
                children.forEach(cacheNode);

                // Get node content (async operation)
                const content = await getNodeContent(node);

                // Get previews for all children
                const childrenWithPreviews = await Promise.all(
                    children.map(async (child) => ({
                        id: child.id,
                        title: getNodeTitle(child),
                        preview: (await getNodeContent(child)).slice(0, 200)
                    }))
                );

                emitEvent('tool_call', {
                    tool: 'getNodeContent',
                    nodeId,
                    nodeTitle: getNodeTitle(node),
                    contentLength: content.length
                    //childrenCount: children.length
                });

                return {
                    nodeId,
                    title: getNodeTitle(node),
                    content: content,
                    nodeType: node.nodeTypeName() || "unknown",
                    children: childrenWithPreviews
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
                        const parentContent = await getNodeContent(parent);
                        emitEvent('tool_call', {
                            tool: 'getParentNode',
                            nodeId,
                            parentId: parent.id,
                            parentTitle: getNodeTitle(parent)
                        });
                        return {
                            nodeId: parent.id,
                            title: getNodeTitle(parent),
                            preview: parentContent.slice(0, 200)
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
