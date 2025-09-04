import { Message, Task, TaskState } from '@a2a-js/sdk';

/**
 * A2A Protocol compliant discussion message structure
 */
export interface DiscussionMessage extends Message {
    kind: 'message';
    role: 'user' | 'agent';
    messageId: string;
    contextId: string;           // Shared discussion context
    referenceTaskIds?: string[]; // Reference to related tasks
    parts: Array<{
        kind: 'text';
        text: string;
    }>;
    metadata: {
        discussionMode: boolean;
        discussionRound: number;
        targetAgentUrl?: string;    // URL of target agent
        originalTopic: string;      // Original discussion topic
        participantRole: 'initiator' | 'responder' | 'moderator';
        conversationType: 'bilateral_discussion';
    };
}

/**
 * A2A Task states specific to discussions
 */
export enum DiscussionTaskState {
    SUBMITTED = "submitted",         // Discussion request submitted
    WORKING = "working",             // Agent is processing/thinking
    INPUT_REQUIRED = "input-required", // Waiting for other agent's response
    COMPLETED = "completed",         // Discussion round completed
    FAILED = "failed"               // Discussion failed
}

/**
 * Discussion configuration following A2A patterns
 */
export interface A2ADiscussionConfig {
    topic: string;
    participants: [string, string]; // Two agent URLs
    sharedContextId: string;        // A2A contextId for the entire discussion
    maxRounds: number;
    timeoutMs: number;
    moderationRules?: {
        preventRepetition: boolean;
        requireProgress: boolean;
        maxMessageLength: number;
    };
}

/**
 * Discussion context that maintains A2A protocol compliance
 */
export interface DiscussionContext {
    discussionId: string;
    topic: string;
    contextId: string;              // A2A contextId
    participants: {
        agent1Url: string;
        agent2Url: string;
    };
    currentRound: number;
    maxRounds: number;
    status: 'initializing' | 'active' | 'concluded' | 'error' | 'timeout';
    taskHistory: Task[];            // A2A Task objects
    messageHistory: DiscussionMessage[]; // A2A Messages
    startTime: Date;
    lastActivity: Date;
}

/**
 * A2A compliant task metadata for discussions
 */
export interface DiscussionTaskMetadata {
    discussionId: string;
    contextId: string;
    topic: string;
    round: number;
    participantRole: 'initiator' | 'responder';
    otherParticipantUrl: string;
}

/**
 * Discussion summary following A2A artifact patterns
 */
export interface DiscussionSummary {
    discussionId: string;
    topic: string;
    totalRounds: number;
    participants: string[];
    keyPoints: string[];
    consensus: string[];
    differences: string[];
    conclusion: string;
    generatedAt: Date;
}

/**
 * A2A Task extension for discussions
 */
export interface DiscussionTask extends Task {
    metadata: DiscussionTaskMetadata;
    contextId: string;
    history: DiscussionMessage[];
}

/**
 * Inter-agent message routing information
 */
export interface AgentRouting {
    sourceAgentUrl: string;
    targetAgentUrl: string;
    messageType: 'discussion_invite' | 'discussion_response' | 'discussion_conclude';
    contextId: string;
    taskId?: string;
}

/**
 * Discussion event types for monitoring
 */
export type DiscussionEvent = 
    | { type: 'discussion_started'; data: DiscussionContext }
    | { type: 'message_sent'; data: { from: string; to: string; message: DiscussionMessage } }
    | { type: 'round_completed'; data: { round: number; contextId: string } }
    | { type: 'discussion_concluded'; data: { contextId: string; summary: DiscussionSummary } }
    | { type: 'discussion_error'; data: { error: string; contextId: string } };

/**
 * A2A protocol compliant agent discovery for discussions
 */
export interface DiscussionCapableAgent {
    agentUrl: string;
    agentCard: {
        name: string;
        capabilities: {
            stateTransitionHistory: boolean;
        };
        skills: Array<{
            id: string;
            name: string;
        }>;
    };
    supportsDiscussion: boolean;
}