import {ChatOpenAI} from "@langchain/openai";
import {PromptTemplate} from "@langchain/core/prompts";
import TurndownService from 'turndown'
import showdown from "showdown"
import { getChatModelConfig } from './config';
import { NodeM, TreeM } from "./schema";

// A2A Protocol enhanced interfaces
export interface SearchResult {
    answer: string;
    matched_nodes: MatchedNode[];
    confidence: number;
    processing_time_ms: number;
    metadata?: {
        nodes_evaluated: number;
        search_depth: number;
        model_calls: number;
    };
}

export interface MatchedNode {
    id: string;
    title: string;
    content: string;
    relevance_score: number;
    node_type: string;
}

export interface SearchOptions {
    max_nodes?: number;
    include_metadata?: boolean;
    confidence_threshold?: number;
}

const model = new ChatOpenAI(getChatModelConfig());

function getNodeContent(node: NodeM) {
    let nodeTypeName = node.nodeTypeName();
    if (!nodeTypeName) {
        console.log(node.title())
        if (node.ymap.get("tabs")["content"] === `<PaperEditorMain/>`) {
            nodeTypeName = "EditorNodeType"
        } else {
            return "Invalid node."
        }
    }
    if (nodeTypeName === "ReaderNodeType") {
        const data = node.data()
        const htmlContent = data.htmlContent
        
        // Check if htmlContent is valid before processing
        if (!htmlContent || typeof htmlContent !== 'string') {
            return "No content available."
        }
        
        const turndownService = new TurndownService()
        try {
            return turndownService.turndown(htmlContent)
        } catch (error) {
            console.warn(`[getNodeContent] Failed to convert HTML to markdown for node ${node.id}:`, error)
            return "Content processing error."
        }
    } else if (nodeTypeName === "EditorNodeType") {
        const editorContent = node.ydata().get("ydatapaperEditor").toJSON()
        if (!editorContent || editorContent.trim().length === 0) {
            return "No content."
        }
        return editorContent
    }
    
    // Fallback for unknown node types
    return "Unknown node type."
}


function getChildren(tree: TreeM, node: NodeM) {
    try {
        const children = tree.getChildren(node);
        // Ensure we always return an iterable, even if tree.getChildren returns undefined
        return children || [];
    } catch (error) {
        console.warn(`[getChildren] Error getting children for node ${node.id}:`, error.message);
        return [];
    }
}

interface PickNextResult {
    matchedNodes: NodeM[];
    parentNodes: NodeM[];
}

async function pickNext(node: NodeM, requirement: string, tree: TreeM): Promise<PickNextResult> {
    let childrenList: NodeM[];
    
    try {
        const children = getChildren(tree, node);
        childrenList = Array.from(children);

        // Reduced logging: console.log(`[pickNext] Node ${node.id} has ${childrenList.length} children`);

        if (childrenList.length === 0) {
            // Reduced logging: console.log("[pickNext] No children found, returning empty arrays");
            return {matchedNodes: [], parentNodes: []};
        }

        if (childrenList.length === 1) {
            // Reduced logging: console.log("[pickNext] Single child found, returning it directly");
            return {matchedNodes: [childrenList[0]], parentNodes: []};
        }
    } catch (error) {
        console.error(`[pickNext] Error processing node ${node.id}:`, error);
        return {matchedNodes: [], parentNodes: []};
    }

    const childrenInPrompt: string[] = [];

    for (let i = 0; i < childrenList.length; i++) {
        const child = childrenList[i];
        const title = typeof child.title === 'string' ? child.title : "";
        const content = getNodeContent(child);
        childrenInPrompt.push(`${i}. ${title} \n ${content}`);
    }

    const childrenPrompt = childrenInPrompt.join("\n");

    const promptTemplate = PromptTemplate.fromTemplate(`
You are traveling on a tree of knowledge. From the following list, you should pick the children that satisfies the requirement, and the children might be the ancestor of the required node.

Children:
{children}

Requirement:
{requirement}

Format:
Output a JSON dict with key "matched_indices" for a list of indices of the children that satisfies the requirement, and key "parent_indices" for a list of indices that might be the ancestor of the required node.
`);


    // @ts-ignore
    const chain = promptTemplate.pipe(model);

    try {
        const response = await chain.invoke({
            children: childrenPrompt,
            requirement: requirement
        });

        // Parse the JSON response
        const content = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            return {matchedNodes: [], parentNodes: []};
        }

        const result = JSON.parse(jsonMatch[0]);
        const matchedIndices = result.matched_indices || [];
        const parentIndices = result.parent_indices || [];

        const matchedChildren = matchedIndices.map((i: number) => childrenList[i]).filter(Boolean);
        const parentChildren = parentIndices.map((i: number) => childrenList[i]).filter(Boolean);

        return {
            matchedNodes: matchedChildren,
            parentNodes: parentChildren
        };
    } catch (error) {
        console.error("Error in pickNext:", error);
        return {matchedNodes: [], parentNodes: []};
    }
}

async function beamSearch(tree: TreeM, query: string): Promise<NodeM[]> {
    try {
        const root = tree.getRoot();
        if (!root) {
            console.error("[beamSearch] Tree root is null or undefined");
            return [];
        }
        
        console.log(`[beamSearch] Starting search with root node: ${root.id}`);
        const nodeQueue: NodeM[] = [root];
        const visitedNodes = new Set<string>();
        const matchedNodesSet = new Set<NodeM>();

    while (nodeQueue.length > 0) {
        const nodeTouched: NodeM[] = [];

        // Process all nodes in the current queue
        const promises = nodeQueue.map(async (node) => {
            return await pickNext(node, query, tree);
        });

        const results = await Promise.all(promises);

        for (const result of results) {
            result.matchedNodes.forEach(node => matchedNodesSet.add(node));
            nodeTouched.push(...result.matchedNodes);
            nodeTouched.push(...result.parentNodes);
        }

        // Clear queue and add new nodes to visit
        nodeQueue.length = 0;
        for (const node of nodeTouched) {
            const nodeId = node.id
            if (!visitedNodes.has(nodeId)) {
                nodeQueue.push(node);
                visitedNodes.add(nodeId);
            }
        }
    }

    return Array.from(matchedNodesSet);
    } catch (error) {
        console.error("[beamSearch] Error during beam search:", error);
        return [];
    }
}

async function generateAnswer(nodes: NodeM[], question: string, treeUrl): Promise<string> {
    console.log(`[generateAnswer] Starting answer generation with ${nodes.length} nodes`);
    console.log(`[generateAnswer] Question: "${question}"`);
    
    const docToPrompt = nodes.map((node, index) => {
        const title = typeof node.title === 'string' ? node.title : "";
        const content = getNodeContent(node);
        console.log(`[generateAnswer] Processing node ${index}: ${title} (${content?.length || 0} chars)`);
        return `${index}: ${title}\n${content}`;
    }).join("\n\n");

    console.log(`[generateAnswer] Document prepared, total length: ${docToPrompt.length} characters`);

    const promptTemplate = PromptTemplate.fromTemplate(`
You are required to answer the question based on the following document.

Document:
{document}

Question:
{question}

You answer in markdown directly without any formatting. 
In your answer, whenever you want to make a statement, you should insert reference tags <ref id="index"/> where index is the number of the document section you're referencing.
`);

    console.log(`[generateAnswer] Prompt template created, preparing chain...`);
    
    // @ts-ignore
    const chain = promptTemplate.pipe(model);
    
    console.log(`[generateAnswer] Chain created, invoking LLM model...`);

    try {
        const response = await chain.invoke({
            document: docToPrompt,
            question: question
        });
        
        console.log(`[generateAnswer] LLM response received, length: ${response.content?.length || 0} chars`);

        const markdownAnswer = response.content as string;
        console.log(`[generateAnswer] Markdown answer extracted, length: ${markdownAnswer?.length || 0} chars`);
        
        const converter = new showdown.Converter();
        console.log(`[generateAnswer] Showdown converter created, converting to HTML...`);
        
        const htmlAnswer = converter.makeHtml(markdownAnswer);
        console.log(`[generateAnswer] HTML conversion completed, length: ${htmlAnswer?.length || 0} chars`);

        // parse the html, replace <ref id="index"/> with <a href="#index">[ref]</a>
        console.log(`[generateAnswer] Starting reference replacement...`);
        const refRegex = /<ref id="(\d+)"\/>/g;
        const getNodeId = (index: number) => {
            const node = nodes[index];
            if (node) {
                return node.id;
            } else {
                console.warn(`Node with index ${index} not found.`);
                return null;
            }
        }
        const htmlAnswerWithRefs = htmlAnswer.replace(refRegex, (match, index) => {
            return `<a href="${treeUrl}&n=${getNodeId(index)}" target="_blank">[ref]</a>`;
        });
        console.log(`[generateAnswer] Reference replacement completed, final length: ${htmlAnswerWithRefs?.length || 0} chars`);
        console.log(`[generateAnswer] Successfully completed answer generation`);
        
        return htmlAnswerWithRefs
    } catch (error) {
        console.error("[generateAnswer] Error generating answer:", error);
        console.error("[generateAnswer] Error stack:", error.stack);
        console.error("[generateAnswer] Error occurred during answer generation process");
        return "Unable to generate answer due to an error.";
    }
}

// Enhanced search function for A2A protocol support
export async function enhancedSearch(
    question: string,
    treeId: string,
    host: string = 'http://0.0.0.0:29999',
    options: SearchOptions = {}
): Promise<SearchResult> {
    const startTime = Date.now();
    const stats = {
        nodes_evaluated: 0,
        search_depth: 0,
        model_calls: 0
    };

    let tree = null;
    try {
        const wsHost = host.replace("http", "ws");
        console.log(`[enhancedSearch] Starting enhanced search...`);
        console.log(`[enhancedSearch] Input parameters:`);
        console.log(`  Question: "${question}"`);
        console.log(`  TreeID: ${treeId}`);
        console.log(`  Original Host: ${host}`);
        console.log(`  WebSocket Host: ${wsHost}`);
        console.log(`  Options:`, options);
        
        console.log(`[enhancedSearch] Attempting WebSocket connection...`);
        
        // Add timeout to prevent hanging with better cleanup
        let timeoutId = null;
        const treePromise = TreeM.treeFromWsWait(wsHost, treeId);
        const timeoutPromise = new Promise((_, reject) => {
            timeoutId = setTimeout(() => {
                console.log(`[enhancedSearch] WebSocket connection timeout after 60 seconds!`);
                reject(new Error(`Tree connection timeout after 60 seconds. Host: ${wsHost}, TreeID: ${treeId}`));
            }, 60000);
        });
        
        try {
            tree = await Promise.race([treePromise, timeoutPromise]);
            if (timeoutId) clearTimeout(timeoutId);
        } catch (error) {
            if (timeoutId) clearTimeout(timeoutId);
            throw error;
        }
        
        if (!tree) {
            throw new Error(`Failed to connect to tree. Host: ${wsHost}, TreeID: ${treeId}`);
        }
        
        // Verify tree has a root
        const root = tree.getRoot();
        if (!root) {
            throw new Error(`Tree has no root node. TreeID: ${treeId}`);
        }
        
        console.log(`[enhancedSearch] Tree connection established, root: ${root.id}, starting beam search...`);
        
        const matchedNodes = await beamSearch(tree, question);
        stats.nodes_evaluated = matchedNodes.length;
        
        const treeUrl = new URL(`?id=${treeId}`, host).toString();
        let answer = "No relevant information found.";
        let confidence = 0.0;

        if (matchedNodes.length > 0) {
            // Limit nodes if max_nodes is specified
            const nodesToProcess = options.max_nodes 
                ? matchedNodes.slice(0, options.max_nodes)
                : matchedNodes;
            
            console.log(`Generating answer from ${nodesToProcess.length} nodes...`);
            answer = await generateAnswer(nodesToProcess, question, treeUrl);
            confidence = calculateConfidence(nodesToProcess, question);
            stats.model_calls += 1; // Simplified tracking
        }

        const processedNodes: MatchedNode[] = matchedNodes.map((node, index) => ({
            id: node.id,
            title: typeof node.title === 'string' ? node.title : node.title() || "Untitled",
            content: getNodeContent(node)?.slice(0, 200) || "No content", // Truncate for metadata
            relevance_score: calculateRelevanceScore(node, question, index),
            node_type: node.nodeTypeName() || "unknown"
        }));

        const result: SearchResult = {
            answer,
            matched_nodes: processedNodes,
            confidence,
            processing_time_ms: Date.now() - startTime
        };

        if (options.include_metadata) {
            result.metadata = stats;
        }

        return result;
    } catch (error) {
        console.error("Error in enhanced search:", error);
        return {
            answer: "Error occurred during search: " + error.message,
            matched_nodes: [],
            confidence: 0.0,
            processing_time_ms: Date.now() - startTime
        };
    } finally {
        // Clean up WebSocket connection
        if (tree && typeof tree.close === 'function') {
            try {
                tree.close();
                console.log(`[enhancedSearch] WebSocket connection closed for TreeID: ${treeId}`);
            } catch (closeError) {
                console.warn(`[enhancedSearch] Error closing WebSocket connection:`, closeError);
            }
        }
    }
}

// Helper functions for A2A enhanced features
function calculateConfidence(nodes: NodeM[], question: string): number {
    if (nodes.length === 0) return 0.0;
    
    // Simple confidence calculation based on number of nodes and content quality
    const baseConfidence = Math.min(nodes.length / 5, 1.0); // More nodes = higher confidence, cap at 1.0
    const contentQuality = nodes.filter(node => {
        const content = getNodeContent(node);
        return content && content.length > 50; // Has substantial content
    }).length / nodes.length;
    
    return Math.round((baseConfidence * 0.6 + contentQuality * 0.4) * 100) / 100;
}

function calculateRelevanceScore(node: NodeM, question: string, index: number): number {
    // Simple relevance scoring - in practice, you might use more sophisticated methods
    const content = getNodeContent(node) || "";
    const title = typeof node.title === 'string' ? node.title : node.title() || "";
    
    const questionWords = question.toLowerCase().split(/\s+/);
    const textToCheck = (title + " " + content).toLowerCase();
    
    const matches = questionWords.filter(word => textToCheck.includes(word)).length;
    const baseScore = matches / questionWords.length;
    
    // Higher ranking nodes get slightly higher relevance
    const rankingBonus = Math.max(0.1, 1 - (index * 0.05));
    
    return Math.round(Math.min(baseScore * rankingBonus, 1.0) * 100) / 100;
}

// Legacy function for backward compatibility
export async function beamSearchMain(question: string, treeId: string, host: string = 'http://0.0.0.0:29999') {
    const result = await enhancedSearch(question, treeId, host);
    return result.answer;
}

//beamSearchMain("What is the methodology of the paper","aaae6158-7889-4e4a-a200-14d9f54cb467", "https://treer.ai")