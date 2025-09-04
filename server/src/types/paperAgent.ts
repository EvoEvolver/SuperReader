import { AgentCard } from '@a2a-js/sdk/server';

/**
 * Configuration interface for PaperAgent
 */
export interface PaperAgentConfig {
    /** Unique identifier for the knowledge tree */
    treeId: string;
    /** Full URL to the knowledge tree */
    treeUrl: string;
    /** Title of the paper (optional, will be extracted if not provided) */
    paperTitle?: string;
    /** Host URL for the tree service (defaults to https://treer.ai) */
    host?: string;
    /** Port number for this agent's HTTP server */
    agentPort: number;
    /** Maximum number of nodes to search (default: 10) */
    maxNodes?: number;
}

/**
 * Paper-specific metadata that gets embedded in Agent Cards
 */
export interface PaperAgentMetadata {
    paper_tree_id: string;
    paper_tree_url: string;
    paper_title: string;
    agent_type: 'paper_agent';
    specialization: 'single_paper_discussion';
    created_at: string;
    host: string;
}

/**
 * Enhanced Agent Card specifically for Paper Agents
 */
export interface PaperAgentCard extends AgentCard {
    metadata: PaperAgentMetadata;
}

/**
 * Discussion-specific capabilities for paper agents
 */
export interface PaperDiscussionSkill {
    id: 'discuss_methodology' | 'discuss_findings' | 'compare_concepts' | 'summarize_content';
    name: string;
    description: string;
    examples: string[];
}

/**
 * Registry entry for tracking active paper agents
 */
export interface PaperAgentEntry {
    agent: any; // Will be PaperAgent once implemented
    config: PaperAgentConfig;
    agentCard: PaperAgentCard;
    createdAt: Date;
    lastActive: Date;
    status: 'initializing' | 'active' | 'error' | 'stopped';
}