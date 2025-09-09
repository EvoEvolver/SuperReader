import { worker_endpoint } from "./config";
import { extractTreeIdFromUrl, validateTreeUrl } from "./discussion-api";

// Utility function to replace agent URL domain with current browser domain
function normalizeAgentUrl(agentUrl: string | undefined): string {
    // Handle undefined or empty URL
    if (!agentUrl || agentUrl.trim() === '') {
        console.warn('Agent URL is undefined or empty');
        return '';
    }

    try {
        const url = new URL(agentUrl);
        const currentHostname = window.location.hostname;
        
        // If current browser is localhost, ensure the URL uses localhost:8081 (backend port)
        if (currentHostname === 'localhost') {
            if (url.hostname === 'localhost') {
                // Replace any localhost port with 8081 (backend port)
                return agentUrl.replace(/localhost:\d+/, 'localhost:8081');
            }
            return agentUrl;
        }
        
        // For production: replace any localhost references with current origin
        if (url.hostname === 'localhost') {
            const currentOrigin = window.location.origin;
            return agentUrl.replace(url.origin, currentOrigin);
        }
        
        return agentUrl;
    } catch (error) {
        console.warn('Failed to normalize agent URL:', agentUrl, error);
        return agentUrl || '';
    }
}

// Agent information interface
export interface AgentInfo {
    treeId: string;
    paperTitle: string;
    agentUrl: string;
    agentCard: AgentCard;
    status: string;
    createdAt: string;
    lastActive: string;
    iconUrl?: string;
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

// Agent creation result interface
export interface AgentCreationResult {
    treeId: string;
    agentUrl: string;
    paperTitle: string;
    status: 'created' | 'existing';
    message: string;
    iconUrl?: string;
}

// Create a new agent
export async function createAgent(treeUrl: string, paperTitle: string, maxNodes: number = 15, iconUrl?: string): Promise<AgentCreationResult> {
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
            maxNodes: maxNodes,
            iconUrl: iconUrl
        }),
    });

    if (!response.ok) {
        const errorData = await response.text();
        throw new Error(`Failed to create agent: ${response.status} - ${errorData}`);
    }

    const result = await response.json();
    
    return {
        treeId: treeId,
        agentUrl: normalizeAgentUrl(result.agent_url),
        paperTitle: result.paper_title || paperTitle,
        status: result.status,
        message: result.message,
        iconUrl: iconUrl
    };
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
        agentUrl: normalizeAgentUrl(data.agent_url),
        agentCard: data.agent_card,
        status: data.status,
        createdAt: data.created_at,
        lastActive: data.last_active,
        iconUrl: data.icon_url,
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
        agentUrl: normalizeAgentUrl(agent.agent_url),
        agentCard: agent.agent_card,
        status: agent.status,
        createdAt: agent.created_at,
        lastActive: agent.last_active,
        iconUrl: agent.icon_url,
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