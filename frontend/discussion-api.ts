import { worker_endpoint } from "./config";

// Discussion API types
export interface DiscussionConfig {
    topic: string;
    maxRounds: number;
    agentA: {
        treeUrl: string;
        name?: string;
    };
    agentB: {
        treeUrl: string;
        name?: string;
    };
}

export interface DiscussionMessage {
    messageId: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: string;
    agentId: string;
    agentName: string;
    roundNumber?: number;
}

export interface DiscussionStatus {
    discussionId: string;
    status: 'active' | 'completed' | 'concluded' | 'error' | 'initializing';
    currentRound: number;
    maxRounds: number;
    topic: string;
    startedAt: string;
    completedAt?: string;
    participantCount: number;
    messageCount: number;
    lastMessageAt?: string;
}

export interface DiscussionHistory {
    discussionId: string;
    messages: DiscussionMessage[];
    status: DiscussionStatus;
}

// Register a paper agent and return its ID
export async function registerAgent(treeUrl: string, paperTitle: string, maxNodes: number = 10): Promise<string> {
    const treeId = extractTreeIdFromUrl(treeUrl);
    if (!treeId) {
        throw new Error('Invalid tree URL - could not extract tree ID');
    }

    const response = await fetch(`${worker_endpoint}/paper-agents/register`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            treeId: treeId,
            paperTitle: paperTitle,
            maxNodes: maxNodes
        }),
    });

    if (!response.ok) {
        const errorData = await response.text();
        throw new Error(`Failed to register agent: ${response.status} - ${errorData}`);
    }

    const result = await response.json();
    return treeId; // Return the tree ID for use in discussions
}

// API Functions
export async function initiateDiscussion(config: DiscussionConfig): Promise<{discussionId: string, status: string}> {
    // First, register both agents
    const agent1TreeId = await registerAgent(
        config.agentA.treeUrl, 
        config.agentA.name || 'Agent A Research Paper',
        10
    );
    
    const agent2TreeId = await registerAgent(
        config.agentB.treeUrl, 
        config.agentB.name || 'Agent B Research Paper',
        10
    );

    // Then initiate the discussion using the backend's expected format
    const response = await fetch(`${worker_endpoint}/discussions/initiate`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            topic: config.topic,
            agent1TreeId: agent1TreeId,
            agent2TreeId: agent2TreeId,
            agent1Name: config.agentA.name,
            agent2Name: config.agentB.name,
            maxRounds: config.maxRounds
        }),
    });

    if (!response.ok) {
        const errorData = await response.text();
        throw new Error(`Failed to initiate discussion: ${response.status} - ${errorData}`);
    }

    return await response.json();
}

export async function getDiscussionStatus(discussionId: string): Promise<DiscussionStatus> {
    const response = await fetch(`${worker_endpoint}/discussions/${discussionId}`, {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
        },
    });

    if (!response.ok) {
        throw new Error(`Failed to get discussion status: ${response.status}`);
    }

    return await response.json();
}

export async function getDiscussionHistory(discussionId: string): Promise<DiscussionHistory> {
    const response = await fetch(`${worker_endpoint}/discussions/${discussionId}/history`, {
        method: 'GET', 
        headers: {
            'Content-Type': 'application/json',
        },
    });

    if (!response.ok) {
        throw new Error(`Failed to get discussion history: ${response.status}`);
    }

    return await response.json();
}

export async function concludeDiscussion(discussionId: string): Promise<{status: string}> {
    const response = await fetch(`${worker_endpoint}/discussions/${discussionId}/conclude`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
    });

    if (!response.ok) {
        throw new Error(`Failed to conclude discussion: ${response.status}`);
    }

    return await response.json();
}

// Utility functions
export function extractTreeIdFromUrl(treeUrl: string): string | null {
    // First try URL parameter parsing
    try {
        const url = new URL(treeUrl);
        const params = new URLSearchParams(url.search);
        const id = params.get('id');
        if (id) return id;
    } catch {
        // Not a valid URL, continue with pattern matching
    }
    
    // Try to extract ID from various URL patterns
    const patterns = [
        /[?&]id=([a-f0-9-]{36})/i,  // ?id=uuid or &id=uuid
        /\/([a-f0-9-]{36})/i,       // /uuid
        /tree\/([a-f0-9-]+)/i,      // tree/uuid
        /([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i  // Direct UUID pattern
    ];
    
    for (const pattern of patterns) {
        const match = treeUrl.match(pattern);
        if (match) {
            return match[1];
        }
    }
    
    // If no pattern matches, check if it's already a UUID
    const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
    if (uuidPattern.test(treeUrl.trim())) {
        return treeUrl.trim();
    }
    
    return null;
}

export function validateTreeUrl(treeUrl: string): boolean {
    if (!treeUrl || treeUrl.trim() === '') {
        return false;
    }
    
    // Check if it's a valid URL
    try {
        new URL(treeUrl);
    } catch {
        return false;
    }
    
    // Check if we can extract a tree ID
    return extractTreeIdFromUrl(treeUrl) !== null;
}

export function formatDiscussionMessage(message: any): DiscussionMessage {
    return {
        messageId: message.messageId || `msg-${Date.now()}`,
        role: message.role || 'assistant',
        content: message.content || message.text || '',
        timestamp: message.timestamp || new Date().toISOString(),
        agentId: message.agentId || message.agent_id || 'unknown',
        agentName: message.agentName || message.agent_name || 'Agent',
        roundNumber: message.roundNumber || message.round_number
    };
}