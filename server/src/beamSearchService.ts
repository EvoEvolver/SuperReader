import {NodeM, TreeM} from "@forest/schema"
import {ChatOpenAI} from "@langchain/openai";
import {PromptTemplate} from "@langchain/core/prompts";
import * as dotenv from "dotenv"
import TurndownService from 'turndown'
import showdown from "showdown"

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

dotenv.config();

const model = new ChatOpenAI({
    model: "gpt-4o-mini",
    temperature: 0.5,
});

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
        const turndownService = new TurndownService()
        return turndownService.turndown(htmlContent)
    } else if (nodeTypeName === "EditorNodeType") {
        const editorContent = node.ydata().get("ydatapaperEditor").toJSON()
        if (!editorContent || editorContent.trim().length === 0) {
            return "No content."
        }
        return editorContent
    }
}


function getChildren(tree: TreeM, node: NodeM) {
    return tree.getChildren(node)
}

interface PickNextResult {
    matchedNodes: NodeM[];
    parentNodes: NodeM[];
}

async function pickNext(node: NodeM, requirement: string, tree: TreeM): Promise<PickNextResult> {
    const children = getChildren(tree, node);
    const childrenList = Array.from(children);

    if (childrenList.length === 0) {
        return {matchedNodes: [], parentNodes: []};
    }

    if (childrenList.length === 1) {
        return {matchedNodes: [childrenList[0]], parentNodes: []};
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
    const root = tree.getRoot();
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
}

async function generateAnswer(nodes: NodeM[], question: string, treeUrl): Promise<string> {
    const docToPrompt = nodes.map((node, index) => {
        const title = typeof node.title === 'string' ? node.title : "";
        const content = getNodeContent(node);
        return `${index}: ${title}\n${content}`;
    }).join("\n\n");

    const promptTemplate = PromptTemplate.fromTemplate(`
You are required to answer the question based on the following document.

Document:
{document}

Question:
{question}

You answer in markdown directly without any formatting. 
In your answer, whenever you want to make a statement, you should insert reference tags <ref id="index"/> where index is the number of the document section you're referencing.
`);


    // @ts-ignore
    const chain = promptTemplate.pipe(model);

    try {
        const response = await chain.invoke({
            document: docToPrompt,
            question: question
        });

        const markdownAnswer = response.content as string;
        const converter = new showdown.Converter();
        const htmlAnswer = converter.makeHtml(markdownAnswer);

        // parse the html, replace <ref id="index"/> with <a href="#index">[ref]</a>
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
        return htmlAnswerWithRefs
    } catch (error) {
        console.error("Error generating answer:", error);
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

    try {
        console.log(`[enhancedSearch] Connecting to tree at: ${host.replace("http", "ws")} with ID: ${treeId}`);
        
        // Add timeout to prevent hanging
        const treePromise = TreeM.treeFromWsWait(host.replace("http", "ws"), treeId);
        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Tree connection timeout after 10 seconds')), 10000)
        );
        
        const tree = await Promise.race([treePromise, timeoutPromise]);
        console.log("[enhancedSearch] Tree connection established, starting beam search...");
        
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