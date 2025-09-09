import { worker_endpoint } from "./config";
import { extractTreeIdFromUrl, validateTreeUrl } from "./discussion-api";

// Agent information interface
export interface AgentInfo {
    treeId: string;
    paperTitle: string;
    agentUrl: string;
    agentCard: AgentCard;
    status: string;
    createdAt: string;
    lastActive: string;
    config: {
        host: string;
        maxNodes: number;
    };
}

// Agent card interface
export interface AgentCard {
    name: string;
    description: string;
    url: string;
    version: string;
    capabilities: string[];
    skills: Array<{
        id: string;
        name: string;
        description: string;
    }>;
}

// Agent test response interface
export interface AgentTestResponse {
    treeId: string;
    question: string;
    response: string;
    durationMs: number;
    timestamp: string;
    agentName: string;
}

// Create a new agent
export async function createAgent(treeUrl: string, paperTitle: string, maxNodes: number = 15): Promise<string> {
    const treeId = extractTreeIdFromUrl(treeUrl);
    if (!treeId) {
        throw new Error('Invalid tree URL - could not extract tree ID');
    }

    if (!validateTreeUrl(treeUrl)) {
        throw new Error('Invalid tree URL format');
    }

    const response = await fetch(`${worker_endpoint}/paper-agents/register`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            treeId: treeId,
            paperTitle: paperTitle || `Agent for ${treeId}`,
            maxNodes: maxNodes
        }),
    });

    if (!response.ok) {
        const errorData = await response.text();
        throw new Error(`Failed to create agent: ${response.status} - ${errorData}`);
    }

    const result = await response.json();
    return treeId; // Return the tree ID for use as agent identifier
}

// Get agent information
export async function getAgentInfo(treeId: string): Promise<AgentInfo> {
    const response = await fetch(`${worker_endpoint}/paper-agents/${treeId}`, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
        },
    });

    if (!response.ok) {
        throw new Error(`Failed to get agent info: ${response.status}`);
    }

    const data = await response.json();
    
    // Convert snake_case to camelCase for frontend consistency
    return {
        treeId: data.tree_id,
        paperTitle: data.paper_title,
        agentUrl: data.agent_url,
        agentCard: data.agent_card,
        status: data.status,
        createdAt: data.created_at,
        lastActive: data.last_active,
        config: {
            host: data.config.host,
            maxNodes: data.config.max_nodes
        }
    };
}

// Get agent card
export async function getAgentCard(treeId: string): Promise<AgentCard> {
    const response = await fetch(`${worker_endpoint}/paper-agents/${treeId}/card`, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
        },
    });

    if (!response.ok) {
        throw new Error(`Failed to get agent card: ${response.status}`);
    }

    return await response.json();
}

// Test agent with a question
export async function testAgent(treeId: string, question: string): Promise<AgentTestResponse> {
    const response = await fetch(`${worker_endpoint}/paper-agents/${treeId}/test`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            question: question
        }),
    });

    if (!response.ok) {
        const errorData = await response.text();
        throw new Error(`Failed to test agent: ${response.status} - ${errorData}`);
    }

    const data = await response.json();
    
    // Convert snake_case to camelCase for frontend consistency
    return {
        treeId: data.tree_id,
        question: data.question,
        response: data.response,
        durationMs: data.duration_ms,
        timestamp: data.timestamp,
        agentName: data.agent_name
    };
}

// List all agents
export async function listAgents(): Promise<AgentInfo[]> {
    const response = await fetch(`${worker_endpoint}/paper-agents`, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
        },
    });

    if (!response.ok) {
        throw new Error(`Failed to list agents: ${response.status}`);
    }

    const data = await response.json();
    
    // Convert agents array with snake_case to camelCase
    return data.agents.map((agent: any) => ({
        treeId: agent.tree_id,
        paperTitle: agent.paper_title,
        agentUrl: agent.agent_url,
        agentCard: agent.agent_card,
        status: agent.status,
        createdAt: agent.created_at,
        lastActive: agent.last_active,
        config: {
            host: agent.config.host,
            maxNodes: agent.config.max_nodes
        }
    }));
}

// Delete an agent
export async function deleteAgent(treeId: string): Promise<void> {
    const response = await fetch(`${worker_endpoint}/paper-agents/${treeId}`, {
        method: 'DELETE',
        headers: {
            'Content-Type': 'application/json',
        },
    });

    if (!response.ok) {
        const errorData = await response.text();
        throw new Error(`Failed to delete agent: ${response.status} - ${errorData}`);
    }
}

// Generate agent URL for external use
export function generateAgentUrl(treeId: string): string {
    // Construct the A2A agent URL
    return `${worker_endpoint}/`;
}

// Check if agent exists
export async function agentExists(treeId: string): Promise<boolean> {
    try {
        await getAgentInfo(treeId);
        return true;
    } catch (error) {
        return false;
    }
}