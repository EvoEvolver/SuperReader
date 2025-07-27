import {NodeM, TreeM} from "@forest/schema"
import {ChatOpenAI} from "@langchain/openai";
import {PromptTemplate} from "@langchain/core/prompts";
import * as dotenv from "dotenv"
import TurndownService from 'turndown'
import showdown from "showdown"

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

export async function beamSearchMain(question: string, treeId: string, host: string = 'http://0.0.0.0:29999') {
    const tree = await TreeM.treeFromWsWait(host.replace("http", "ws"), treeId)
    console.log("Starting beam search...");
    const matchedNodes = await beamSearch(tree, question);
    console.log(`Found ${matchedNodes.length} relevant nodes`);
    const treeUrl = new URL(`?id=${treeId}`, host).toString();
    if (matchedNodes.length > 0) {
        console.log("Generating answer...");
        const answer = await generateAnswer(matchedNodes, question, treeUrl);
        console.log("Answer:", answer);
        return answer
    } else {
        console.log("No relevant nodes found.");
    }
}

//beamSearchMain("What is the methodology of the paper","aaae6158-7889-4e4a-a200-14d9f54cb467", "https://treer.ai")