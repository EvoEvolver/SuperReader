import {generateText, stepCountIs} from 'ai';
import {openai} from '@ai-sdk/openai';
import {NodeM, TreeM} from "./schema";
import TurndownService from 'turndown';
import {createAgenticSearchTools} from "./agenticSearchTools";

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

// Event-based agentic search function for SSE
export async function agenticSearchWithEvents(
    question: string,
    treeId: string,
    host: string = 'http://0.0.0.0:29999',
    emitEvent: (event: string, data: any) => void,
    options: AgenticSearchOptions = {}
) {
    const startTime = Date.now();
    const stats = {
        nodes_explored: 0,
        tool_calls: 0,
        search_iterations: 0
    };

    let tree: TreeM | null = null;

    try {
        // Connect to the tree
        const wsHost = host.replace("http", "ws");
        emitEvent('status', {stage: 'connecting', message: 'Connecting to tree...'});

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

        emitEvent('status', {stage: 'connected', message: 'Connected to tree. Starting agentic exploration...'});

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

        emitEvent('status', {
            stage: 'exploring',
            message: `Found ${rootChildren.length} children at root. Starting intelligent exploration...`
        });

        // Create tree URL for references
        const treeUrl = new URL(`?id=${treeId}`, host).toString();

        // Create tools using the factory function
        const tools = createAgenticSearchTools({
            tree: tree!,
            nodeCache,
            relevantNodeIds,
            exploredNodeIds,
            stats,
            emitEvent,
            cacheNode,
            treeUrl
        });

        // Create the agent prompt
        const systemPrompt = `You are a tree exploration agent designed to answer questions by intelligently navigating a hierarchical knowledge tree.

QUESTION TO ANSWER: "${question}"

TREE STRUCTURE:
- Root Node ID: ${root.id}
- Root has ${rootChildren.length} children:
${rootChildrenInfo.map(child => `  - [${child.id}] ${child.title}\n    Preview: ${child.preview}...`).join('\n')}

YOUR TASK:
- Explore the tree strategically to find nodes that help answer the question
- Use markNodeRelevant to flag nodes that contain useful information
- Continue exploring until you have enough information
- Use generateAnswer with a comprehensive markdown report when you're ready to provide the final answer

STRATEGY:
- Start by exploring the most promising root children based on their titles/previews
- Go deeper into branches that seem relevant
- If you encounter image URLs in content, use analyzeImage to extract information from them
- Don't explore exhaustively - focus on quality over quantity
- Mark nodes as relevant as soon as you find useful information
- You can explore multiple branches if needed
- When you have 2-5 relevant nodes with good information, you can generate the answer

IMPORTANT:
- Be strategic and efficient in your exploration
- Don't just mark everything as relevant - be selective
- Always provide reasoning when marking nodes relevant
- When calling generateAnswer, write a comprehensive markdown report that synthesizes the information from the relevant nodes
- In your markdown report, use <ref id="nodeId"/> tags to reference specific nodes (use the actual node IDs you explored)
- The markdown report should directly answer the user's question with clear explanations and proper citations`;

        emitEvent('progress', {
            stage: 'agent_running',
            message: 'AI agent is exploring the tree...',
            stats
        });

        // Run the agent
        const result = await generateText({
            model: openai('gpt-5-mini'),
            tools,
            system: systemPrompt,
            prompt: `Begin exploring the tree to answer the question: "${question}". Start by examining the root's children and then explore the most promising branches.`,
            stopWhen: stepCountIs(50),
        });

        stats.search_iterations = result.steps.length;

        emitEvent('status', {
            stage: 'exploration_complete',
            message: `Agent completed exploration in ${result.steps.length} steps. Found ${relevantNodeIds.size} relevant nodes.`,
            stats
        });

        // Emit final metadata if requested
        if (options.include_metadata) {
            emitEvent('metadata', {
                processing_time_ms: Date.now() - startTime,
                stats
            });
        }

    } catch (error) {
        console.error("[agenticSearchWithEvents] Error during agentic search:", error);
        emitEvent('error', {message: error.message || 'An error occurred during search'});
    } finally {
    }
}
