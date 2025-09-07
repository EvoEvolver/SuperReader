import { v4 as uuidv4 } from 'uuid';
import { ChatOpenAI } from "@langchain/openai";
import { PromptTemplate } from "@langchain/core/prompts";
import * as dotenv from "dotenv";
import { enhancedSearch } from './beamSearchService';

dotenv.config();

export interface DiscussionTurn {
    round: number;
    question: string;
    agentAResponse: string;
    agentBResponse: string;
    coordinatorAnalysis: string;
    timestamp: string;
}

export interface IntelligentDiscussionState {
    discussionId: string;
    topic: string;
    status: 'initializing' | 'active' | 'completed' | 'error';
    currentRound: number;
    maxRounds: number;
    agentAInfo: AgentInfo;
    agentBInfo: AgentInfo; 
    turns: DiscussionTurn[];
    summary?: string;
    startTime: Date;
    endTime?: Date;
    error?: string;
}

export interface AgentInfo {
    treeId: string;
    name: string;
    context?: string;  // Brief context extracted from tree
}

export interface DiscussionConfig {
    topic: string;
    maxRounds: number;
    agentA: AgentInfo;
    agentB: AgentInfo;
}

/**
 * Intelligent Discussion Coordinator - LLM-driven discussion management
 * Replaces complex A2A protocol direct communication, providing more stable and intelligent discussion experience
 */
export class IntelligentDiscussionCoordinator {
    private model: ChatOpenAI;
    private activeDiscussions: Map<string, IntelligentDiscussionState> = new Map();
    
    constructor() {
        this.model = new ChatOpenAI({
            model: "gpt-4o-mini",
            temperature: 0.7,  // Slightly higher temperature for more creative questions
        });
    }

    /**
     * Initiate intelligent discussion
     */
    async initiateDiscussion(config: DiscussionConfig): Promise<string> {
        const discussionId = uuidv4();
        console.log(`[IntelligentDiscussionCoordinator] Starting discussion: ${discussionId}`);
        console.log(`[IntelligentDiscussionCoordinator] Topic: "${config.topic}"`);

        const discussion: IntelligentDiscussionState = {
            discussionId,
            topic: config.topic,
            status: 'initializing',
            currentRound: 0,
            maxRounds: config.maxRounds,
            agentAInfo: config.agentA,
            agentBInfo: config.agentB,
            turns: [],
            startTime: new Date()
        };

        this.activeDiscussions.set(discussionId, discussion);

        try {
            // Get agent context information
            await this.initializeAgentContexts(discussion);
            
            // Start discussion process
            discussion.status = 'active';
            this.conductDiscussion(discussion); // Execute asynchronously, non-blocking
            
            return discussionId;
            
        } catch (error) {
            console.error(`[IntelligentDiscussionCoordinator] Failed to initialize discussion:`, error);
            discussion.status = 'error';
            discussion.error = error.message;
            return discussionId;
        }
    }

    /**
     * Get discussion state
     */
    getDiscussionState(discussionId: string): IntelligentDiscussionState | null {
        return this.activeDiscussions.get(discussionId) || null;
    }

    /**
     * Manually conclude discussion
     */
    async concludeDiscussion(discussionId: string): Promise<void> {
        const discussion = this.activeDiscussions.get(discussionId);
        if (discussion && discussion.status === 'active') {
            console.log(`[IntelligentDiscussionCoordinator] Manually concluding discussion: ${discussionId}`);
            await this.finalizeDiscussion(discussion);
        }
    }

    /**
     * Initialize agent context information
     */
    private async initializeAgentContexts(discussion: IntelligentDiscussionState): Promise<void> {
        console.log(`[IntelligentDiscussionCoordinator] Initializing agent contexts...`);
        
        try {
            // Get brief context for each agent for subsequent question generation
            const contextPrompts = await Promise.allSettled([
                this.getAgentContext(discussion.agentAInfo),
                this.getAgentContext(discussion.agentBInfo)
            ]);

            if (contextPrompts[0].status === 'fulfilled') {
                discussion.agentAInfo.context = contextPrompts[0].value;
            }
            if (contextPrompts[1].status === 'fulfilled') {
                discussion.agentBInfo.context = contextPrompts[1].value;
            }

            console.log(`[IntelligentDiscussionCoordinator] Agent contexts initialized successfully`);
        } catch (error) {
            console.warn(`[IntelligentDiscussionCoordinator] Failed to initialize all agent contexts:`, error);
            // Continue execution even without context information
        }
    }

    /**
     * Get agent context information
     */
    private async getAgentContext(agentInfo: AgentInfo): Promise<string> {
        try {
            const contextQuery = "What is the main topic and key findings of this research?";
            const searchResult = await enhancedSearch(
                contextQuery,
                agentInfo.treeId,
                'https://treer.ai',
                { max_nodes: 3, include_metadata: false }
            );
            
            // Extract brief context
            return searchResult.answer.slice(0, 500) + '...';
        } catch (error) {
            console.warn(`[IntelligentDiscussionCoordinator] Failed to get context for ${agentInfo.name}:`, error);
            return `Research focused on ${agentInfo.name}`;
        }
    }

    /**
     * Execute discussion flow - core logic
     */
    private async conductDiscussion(discussion: IntelligentDiscussionState): Promise<void> {
        console.log(`[IntelligentDiscussionCoordinator] Starting discussion flow for ${discussion.discussionId}`);

        try {
            while (discussion.currentRound < discussion.maxRounds && discussion.status === 'active') {
                const currentRound = discussion.currentRound + 1;
                console.log(`[IntelligentDiscussionCoordinator] Starting round ${currentRound}/${discussion.maxRounds}`);

                // 1. Generate question for current round
                const question = await this.generateQuestion(discussion, currentRound);
                console.log(`[IntelligentDiscussionCoordinator] Generated question: "${question}"`);

                // 2. Get responses from both agents
                const [responseA, responseB] = await Promise.allSettled([
                    this.getAgentResponse(discussion.agentAInfo, question),
                    this.getAgentResponse(discussion.agentBInfo, question)
                ]);

                const agentAResponse = responseA.status === 'fulfilled' ? responseA.value : 
                    `Error: Failed to get response from ${discussion.agentAInfo.name}`;
                const agentBResponse = responseB.status === 'fulfilled' ? responseB.value : 
                    `Error: Failed to get response from ${discussion.agentBInfo.name}`;

                console.log(`[IntelligentDiscussionCoordinator] Received responses from both agents`);

                // 3. Analyze responses
                const analysis = await this.analyzeResponses(question, agentAResponse, agentBResponse, discussion);
                
                // 4. Record this round
                const turn: DiscussionTurn = {
                    round: currentRound,
                    question,
                    agentAResponse,
                    agentBResponse,
                    coordinatorAnalysis: analysis,
                    timestamp: new Date().toISOString()
                };
                
                discussion.turns.push(turn);
                discussion.currentRound = currentRound;

                console.log(`[IntelligentDiscussionCoordinator] Completed round ${currentRound}, analysis: ${analysis.slice(0, 100)}...`);

                // 5. Brief pause to avoid excessive API calls
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            // Discussion ended
            await this.finalizeDiscussion(discussion);

        } catch (error) {
            console.error(`[IntelligentDiscussionCoordinator] Error during discussion:`, error);
            discussion.status = 'error';
            discussion.error = error.message;
            discussion.endTime = new Date();
        }
    }

    /**
     * Generate discussion question
     */
    private async generateQuestion(discussion: IntelligentDiscussionState, round: number): Promise<string> {
        let promptTemplate: PromptTemplate;

        if (round === 1) {
            // First round: opening question
            promptTemplate = PromptTemplate.fromTemplate(`
You are an academic discussion moderator organizing a dialogue between two research domain experts.

Discussion Topic: {topic}

Participants:
- {agentAName}: {agentAContext}
- {agentBName}: {agentBContext}

Generate an open-ended question for the first round of discussion. The question should:
1. Be directly related to the topic
2. Provoke dialogue from two different research perspectives
3. Avoid being overly technical while maintaining comprehensibility
4. Encourage comparison and contrast of different approaches

Return only the question, no additional explanation needed.
            `);
        } else {
            // Subsequent rounds: generate in-depth questions based on previous discussion
            const previousTurn = discussion.turns[discussion.turns.length - 1];
            
            promptTemplate = PromptTemplate.fromTemplate(`
Continue the in-depth exploration based on the previous discussion.

Discussion Topic: {topic}
This is round {round} of the discussion.

Previous question: {previousQuestion}

Previous response from {agentAName}: {previousResponseA}

Previous response from {agentBName}: {previousResponseB}

Analysis: {previousAnalysis}

Generate the next question that should:
1. Build on points of divergence or convergence from the previous round
2. Further explore details or practical applications
3. Guide deeper comparisons
4. Maintain discussion coherence

Return only the question, no additional explanation needed.
            `);
        }

        const chain = promptTemplate.pipe(this.model);
        
        const variables = round === 1 ? {
            topic: discussion.topic,
            agentAName: discussion.agentAInfo.name,
            agentAContext: discussion.agentAInfo.context || `${discussion.agentAInfo.name} research`,
            agentBName: discussion.agentBInfo.name, 
            agentBContext: discussion.agentBInfo.context || `${discussion.agentBInfo.name} research`
        } : {
            topic: discussion.topic,
            round: round.toString(),
            agentAName: discussion.agentAInfo.name,
            agentBName: discussion.agentBInfo.name,
            previousQuestion: discussion.turns[discussion.turns.length - 1].question,
            previousResponseA: discussion.turns[discussion.turns.length - 1].agentAResponse,
            previousResponseB: discussion.turns[discussion.turns.length - 1].agentBResponse,
            previousAnalysis: discussion.turns[discussion.turns.length - 1].coordinatorAnalysis
        };

        const response = await chain.invoke(variables);
        return (response.content as string).trim();
    }

    /**
     * Get agent response
     */
    private async getAgentResponse(agentInfo: AgentInfo, question: string): Promise<string> {
        console.log(`[IntelligentDiscussionCoordinator] Getting response from ${agentInfo.name}...`);
        
        try {
            const searchResult = await enhancedSearch(
                question,
                agentInfo.treeId,
                'https://treer.ai',
                { 
                    max_nodes: 8, 
                    include_metadata: false,
                    confidence_threshold: 0.1 
                }
            );

            if (searchResult.answer && searchResult.answer !== "No relevant information found." && 
                !searchResult.answer.startsWith("Error occurred during search")) {
                return searchResult.answer;
            } else if (searchResult.answer.startsWith("Error occurred during search")) {
                // Handle WebSocket timeout or other errors gracefully
                console.warn(`[IntelligentDiscussionCoordinator] Search error for ${agentInfo.name}, providing fallback response`);
                return `I apologize, but I'm experiencing temporary connectivity issues accessing my research data. Based on my general knowledge of ${agentInfo.name.includes('Quantum') ? 'quantum physics' : 'documentation methods'}, I believe this is an important question that would benefit from ${agentInfo.name.includes('Quantum') ? 'theoretical analysis' : 'practical implementation'} considerations.`;
            } else {
                return `I apologize, but I couldn't find specific information in my research materials to address "${question}" directly. This question might be outside my current knowledge scope, or it might benefit from being rephrased to better match my area of expertise.`;
            }

        } catch (error) {
            console.error(`[IntelligentDiscussionCoordinator] Error getting response from ${agentInfo.name}:`, error);
            
            // Provide a more meaningful fallback based on agent type
            const isQuantum = agentInfo.name.toLowerCase().includes('quantum');
            const fallbackContext = isQuantum 
                ? 'quantum physics theoretical frameworks and their mathematical foundations'
                : 'practical documentation methods and knowledge organization systems';
                
            return `I encountered technical difficulties accessing my research database. However, based on my expertise in ${fallbackContext}, this question touches on important aspects that deserve careful consideration. I would recommend exploring this topic through multiple perspectives to gain a comprehensive understanding.`;
        }
    }

    /**
     * Analyze responses from both agents
     */
    private async analyzeResponses(
        question: string, 
        responseA: string, 
        responseB: string, 
        discussion: IntelligentDiscussionState
    ): Promise<string> {
        
        const promptTemplate = PromptTemplate.fromTemplate(`
As an academic discussion moderator, please analyze the responses from two experts to the same question.

Question: {question}

Response from {agentAName}:
{responseA}

Response from {agentBName}:
{responseB}

Please provide a concise analysis including:
1. Similarities and differences in main viewpoints
2. Complementary aspects of the two methods/perspectives
3. Potential points of controversy or areas requiring further exploration

The analysis should be objective, concise, and prepare for the next round of discussion. Limit to 200 words.
        `);

        const chain = promptTemplate.pipe(this.model);
        
        const response = await chain.invoke({
            question,
            agentAName: discussion.agentAInfo.name,
            responseA: responseA.slice(0, 1000), // Limit length to avoid token limit
            agentBName: discussion.agentBInfo.name,
            responseB: responseB.slice(0, 1000)
        });

        return (response.content as string).trim();
    }

    /**
     * Conclude discussion and generate summary
     */
    private async finalizeDiscussion(discussion: IntelligentDiscussionState): Promise<void> {
        console.log(`[IntelligentDiscussionCoordinator] Finalizing discussion ${discussion.discussionId}`);
        
        try {
            // Generate discussion summary
            const summary = await this.generateSummary(discussion);
            discussion.summary = summary;
            
            discussion.status = 'completed';
            discussion.endTime = new Date();

            console.log(`[IntelligentDiscussionCoordinator] Discussion completed: ${discussion.discussionId}`);
            console.log(`[IntelligentDiscussionCoordinator] Summary: ${summary.slice(0, 200)}...`);

        } catch (error) {
            console.error(`[IntelligentDiscussionCoordinator] Error finalizing discussion:`, error);
            discussion.status = 'error';
            discussion.error = error.message;
            discussion.endTime = new Date();
        }
    }

    /**
     * Generate discussion summary
     */
    private async generateSummary(discussion: IntelligentDiscussionState): Promise<string> {
        const turnsText = discussion.turns.map(turn => 
            `Round ${turn.round}: ${turn.question}\n` +
            `${discussion.agentAInfo.name}: ${turn.agentAResponse.slice(0, 300)}\n` +
            `${discussion.agentBInfo.name}: ${turn.agentBResponse.slice(0, 300)}\n` +
            `Analysis: ${turn.coordinatorAnalysis}\n`
        ).join('\n---\n');

        const promptTemplate = PromptTemplate.fromTemplate(`
Please generate a comprehensive summary report for the following academic discussion.

Discussion Topic: {topic}
Participants: {agentAName} vs {agentBName}
Rounds: {roundCount}

Discussion Process:
{turnsText}

Please generate a structured summary report including:
1. Discussion overview
2. Comparison of main viewpoints
3. Key findings and insights
4. Conclusions and recommendations

The report should be objective, comprehensive, and suitable for academic exchange.
        `);

        const chain = promptTemplate.pipe(this.model);
        
        const response = await chain.invoke({
            topic: discussion.topic,
            agentAName: discussion.agentAInfo.name,
            agentBName: discussion.agentBInfo.name,
            roundCount: discussion.turns.length.toString(),
            turnsText: turnsText
        });

        return (response.content as string).trim();
    }

    /**
     * Clean up completed discussions
     */
    public cleanup(): void {
        const now = Date.now();
        const cleanup_threshold = 60 * 60 * 1000; // 1 hour

        for (const [id, discussion] of this.activeDiscussions.entries()) {
            if (discussion.status !== 'active' && discussion.endTime) {
                const elapsed = now - discussion.endTime.getTime();
                if (elapsed > cleanup_threshold) {
                    console.log(`[IntelligentDiscussionCoordinator] Cleaning up discussion: ${id}`);
                    this.activeDiscussions.delete(id);
                }
            }
        }
    }
}