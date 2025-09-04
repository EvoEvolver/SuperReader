import { v4 as uuidv4 } from 'uuid';
import { ChatOpenAI } from "@langchain/openai";
import { PromptTemplate } from "@langchain/core/prompts";
import * as dotenv from "dotenv";
import { enhancedSearch } from './beamSearchService';

dotenv.config();

// 智能讨论状态接口
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
    context?: string;  // 从tree中提取的简要上下文
}

export interface DiscussionConfig {
    topic: string;
    maxRounds: number;
    agentA: AgentInfo;
    agentB: AgentInfo;
}

/**
 * 智能讨论协调器 - LLM驱动的讨论管理
 * 替代复杂的A2A协议直接通信，提供更稳定和智能的讨论体验
 */
export class IntelligentDiscussionCoordinator {
    private model: ChatOpenAI;
    private activeDiscussions: Map<string, IntelligentDiscussionState> = new Map();
    
    constructor() {
        this.model = new ChatOpenAI({
            model: "gpt-4o-mini",
            temperature: 0.7,  // 稍高温度以获得更有创意的问题
        });
    }

    /**
     * 启动智能讨论
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
            // 获取agents的上下文信息
            await this.initializeAgentContexts(discussion);
            
            // 开始讨论流程
            discussion.status = 'active';
            this.conductDiscussion(discussion); // 异步执行，不阻塞
            
            return discussionId;
            
        } catch (error) {
            console.error(`[IntelligentDiscussionCoordinator] Failed to initialize discussion:`, error);
            discussion.status = 'error';
            discussion.error = error.message;
            return discussionId;
        }
    }

    /**
     * 获取讨论状态
     */
    getDiscussionState(discussionId: string): IntelligentDiscussionState | null {
        return this.activeDiscussions.get(discussionId) || null;
    }

    /**
     * 手动结束讨论
     */
    async concludeDiscussion(discussionId: string): Promise<void> {
        const discussion = this.activeDiscussions.get(discussionId);
        if (discussion && discussion.status === 'active') {
            console.log(`[IntelligentDiscussionCoordinator] Manually concluding discussion: ${discussionId}`);
            await this.finalizeDiscussion(discussion);
        }
    }

    /**
     * 初始化agent上下文信息
     */
    private async initializeAgentContexts(discussion: IntelligentDiscussionState): Promise<void> {
        console.log(`[IntelligentDiscussionCoordinator] Initializing agent contexts...`);
        
        try {
            // 为每个agent获取简要上下文，用于后续问题生成
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
            // 继续执行，即使没有上下文信息
        }
    }

    /**
     * 获取agent的上下文信息
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
            
            // 提取简要上下文
            return searchResult.answer.slice(0, 500) + '...';
        } catch (error) {
            console.warn(`[IntelligentDiscussionCoordinator] Failed to get context for ${agentInfo.name}:`, error);
            return `Research focused on ${agentInfo.name}`;
        }
    }

    /**
     * 执行讨论流程 - 核心逻辑
     */
    private async conductDiscussion(discussion: IntelligentDiscussionState): Promise<void> {
        console.log(`[IntelligentDiscussionCoordinator] Starting discussion flow for ${discussion.discussionId}`);

        try {
            while (discussion.currentRound < discussion.maxRounds && discussion.status === 'active') {
                const currentRound = discussion.currentRound + 1;
                console.log(`[IntelligentDiscussionCoordinator] Starting round ${currentRound}/${discussion.maxRounds}`);

                // 1. 生成当前轮次的问题
                const question = await this.generateQuestion(discussion, currentRound);
                console.log(`[IntelligentDiscussionCoordinator] Generated question: "${question}"`);

                // 2. 获取两个agent的回答
                const [responseA, responseB] = await Promise.allSettled([
                    this.getAgentResponse(discussion.agentAInfo, question),
                    this.getAgentResponse(discussion.agentBInfo, question)
                ]);

                const agentAResponse = responseA.status === 'fulfilled' ? responseA.value : 
                    `Error: Failed to get response from ${discussion.agentAInfo.name}`;
                const agentBResponse = responseB.status === 'fulfilled' ? responseB.value : 
                    `Error: Failed to get response from ${discussion.agentBInfo.name}`;

                console.log(`[IntelligentDiscussionCoordinator] Received responses from both agents`);

                // 3. 分析回答
                const analysis = await this.analyzeResponses(question, agentAResponse, agentBResponse, discussion);
                
                // 4. 记录这一轮
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

                // 5. 短暂暂停，避免API调用过于频繁
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            // 讨论结束
            await this.finalizeDiscussion(discussion);

        } catch (error) {
            console.error(`[IntelligentDiscussionCoordinator] Error during discussion:`, error);
            discussion.status = 'error';
            discussion.error = error.message;
            discussion.endTime = new Date();
        }
    }

    /**
     * 生成讨论问题
     */
    private async generateQuestion(discussion: IntelligentDiscussionState, round: number): Promise<string> {
        let promptTemplate: PromptTemplate;

        if (round === 1) {
            // 第一轮：开场问题
            promptTemplate = PromptTemplate.fromTemplate(`
你是一个学术讨论的主持人。现在要组织两个研究领域的专家进行对话。

讨论主题: {topic}

参与者:
- {agentAName}: {agentAContext}
- {agentBName}: {agentBContext}

请为第一轮讨论生成一个开放性的问题，这个问题应该:
1. 与主题直接相关
2. 能够引发两个不同研究视角的对话
3. 避免过于技术性，保持可理解性
4. 鼓励比较和对比不同方法

直接返回问题，不需要其他解释。
            `);
        } else {
            // 后续轮次：基于之前讨论生成深入问题
            const previousTurn = discussion.turns[discussion.turns.length - 1];
            
            promptTemplate = PromptTemplate.fromTemplate(`
基于之前的讨论，继续深入探讨。

讨论主题: {topic}
当前是第 {round} 轮讨论。

上一轮问题: {previousQuestion}

上一轮{agentAName}的回答: {previousResponseA}

上一轮{agentBName}的回答: {previousResponseB}

分析: {previousAnalysis}

请生成下一个问题，这个问题应该:
1. 基于上轮讨论的分歧点或共同点
2. 进一步探索细节或实际应用
3. 引导更深入的比较
4. 保持讨论的连贯性

直接返回问题，不需要其他解释。
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
     * 获取agent回答
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
     * 分析两个agent的回答
     */
    private async analyzeResponses(
        question: string, 
        responseA: string, 
        responseB: string, 
        discussion: IntelligentDiscussionState
    ): Promise<string> {
        
        const promptTemplate = PromptTemplate.fromTemplate(`
作为学术讨论的主持人，请分析两个专家对同一问题的回答。

问题: {question}

{agentAName}的回答:
{responseA}

{agentBName}的回答:  
{responseB}

请提供简洁的分析，包括:
1. 主要观点的异同
2. 两种方法/观点的互补性
3. 可能的争议点或需要进一步探讨的方面

分析应该客观、简洁，为下一轮讨论做准备。限制在200字以内。
        `);

        const chain = promptTemplate.pipe(this.model);
        
        const response = await chain.invoke({
            question,
            agentAName: discussion.agentAInfo.name,
            responseA: responseA.slice(0, 1000), // 限制长度避免超过token限制
            agentBName: discussion.agentBInfo.name,
            responseB: responseB.slice(0, 1000)
        });

        return (response.content as string).trim();
    }

    /**
     * 结束讨论并生成总结
     */
    private async finalizeDiscussion(discussion: IntelligentDiscussionState): Promise<void> {
        console.log(`[IntelligentDiscussionCoordinator] Finalizing discussion ${discussion.discussionId}`);
        
        try {
            // 生成讨论总结
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
     * 生成讨论总结
     */
    private async generateSummary(discussion: IntelligentDiscussionState): Promise<string> {
        const turnsText = discussion.turns.map(turn => 
            `轮次${turn.round}: ${turn.question}\n` +
            `${discussion.agentAInfo.name}: ${turn.agentAResponse.slice(0, 300)}\n` +
            `${discussion.agentBInfo.name}: ${turn.agentBResponse.slice(0, 300)}\n` +
            `分析: ${turn.coordinatorAnalysis}\n`
        ).join('\n---\n');

        const promptTemplate = PromptTemplate.fromTemplate(`
请为以下学术讨论生成一个全面的总结报告。

讨论主题: {topic}
参与者: {agentAName} vs {agentBName}
轮次: {roundCount}

讨论过程:
{turnsText}

请生成结构化的总结报告，包括:
1. 讨论概述
2. 主要观点对比
3. 关键发现和洞察
4. 结论和建议

报告应该客观、全面，适合学术交流。
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
     * 清理已完成的讨论
     */
    public cleanup(): void {
        const now = Date.now();
        const cleanup_threshold = 60 * 60 * 1000; // 1小时

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