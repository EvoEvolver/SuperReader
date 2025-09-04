import { enhancedSearch, SearchResult, SearchOptions } from './beamSearchService';

/**
 * 简化的Agent接口 - 绕过复杂的A2A协议，直接调用搜索功能
 * 用于新的智能讨论架构，提供更稳定的agent交互
 */
export class SimpleAgentInterface {
    private treeId: string;
    private name: string;
    private host: string;
    
    constructor(treeId: string, name: string, host: string = 'https://treer.ai') {
        this.treeId = treeId;
        this.name = name;
        this.host = host;
    }

    /**
     * 向agent提问并获取回答
     * @param question 问题
     * @param options 搜索选项
     * @returns 回答文本
     */
    async ask(question: string, options?: SearchOptions): Promise<string> {
        console.log(`[SimpleAgentInterface] ${this.name} answering: "${question}"`);
        
        try {
            const searchOptions: SearchOptions = {
                max_nodes: 10,
                include_metadata: false,
                confidence_threshold: 0.1,
                ...options
            };

            const startTime = Date.now();
            const searchResult: SearchResult = await enhancedSearch(
                question,
                this.treeId,
                this.host,
                searchOptions
            );
            
            const duration = Date.now() - startTime;
            console.log(`[SimpleAgentInterface] ${this.name} completed search in ${duration}ms`);
            console.log(`[SimpleAgentInterface] Found ${searchResult.matched_nodes.length} relevant nodes`);
            console.log(`[SimpleAgentInterface] Confidence: ${searchResult.confidence}`);

            // 检查搜索结果质量
            if (searchResult.answer && 
                searchResult.answer !== "No relevant information found." && 
                !searchResult.answer.startsWith("Error occurred during search")) {
                
                return this.formatResponse(searchResult.answer, question);
            } else {
                return this.generateFallbackResponse(question, searchResult);
            }

        } catch (error) {
            console.error(`[SimpleAgentInterface] Error in ${this.name} search:`, error);
            return this.generateErrorResponse(question, error);
        }
    }

    /**
     * 获取agent的基本信息和能力
     */
    async getCapabilities(): Promise<AgentCapabilities> {
        try {
            // 通过一个通用问题来测试agent的响应能力
            const testQuestion = "What is the main focus of this research?";
            const response = await this.ask(testQuestion, { max_nodes: 3 });
            
            return {
                name: this.name,
                treeId: this.treeId,
                available: true,
                lastTested: new Date().toISOString(),
                sampleResponse: response.slice(0, 200) + '...'
            };
        } catch (error) {
            return {
                name: this.name,
                treeId: this.treeId,
                available: false,
                lastTested: new Date().toISOString(),
                error: error.message
            };
        }
    }

    /**
     * 格式化回答，确保回答的质量和可读性
     */
    private formatResponse(rawAnswer: string, question: string): string {
        // 基本清理和格式化
        let formattedAnswer = rawAnswer.trim();
        
        // 如果回答太短，添加一些上下文
        if (formattedAnswer.length < 100) {
            formattedAnswer = `Based on my research, ${formattedAnswer}`;
        }

        // 确保回答以适当的方式结束
        if (!formattedAnswer.endsWith('.') && !formattedAnswer.endsWith('!') && !formattedAnswer.endsWith('?')) {
            formattedAnswer += '.';
        }

        return formattedAnswer;
    }

    /**
     * 当搜索没有找到相关信息时的回退回答
     */
    private generateFallbackResponse(question: string, searchResult: SearchResult): string {
        if (searchResult.matched_nodes.length > 0) {
            return `While I found some related information in my research, I don't have specific details to fully answer "${question}". The available information suggests there might be relevant content, but it may require a more specific question or different approach to access the most relevant insights.`;
        } else {
            return `I apologize, but I couldn't find specific information in my research materials to address the question "${question}". This might be outside the scope of my knowledge base, or the question might benefit from being rephrased or made more specific to my area of expertise.`;
        }
    }

    /**
     * 生成错误回答
     */
    private generateErrorResponse(question: string, error: any): string {
        const errorType = error.message.includes('timeout') ? 'connection timeout' : 'system error';
        return `I encountered a ${errorType} while trying to research your question "${question}". This is likely a temporary issue with accessing my knowledge base. Could you please try asking the question again, or rephrase it in a different way?`;
    }

    /**
     * 健康检查
     */
    async healthCheck(): Promise<boolean> {
        try {
            const response = await this.ask("Hello", { max_nodes: 1 });
            return response.length > 0 && !response.includes("Error");
        } catch (error) {
            console.error(`[SimpleAgentInterface] Health check failed for ${this.name}:`, error);
            return false;
        }
    }

    // Getters
    public getName(): string {
        return this.name;
    }

    public getTreeId(): string {
        return this.treeId;
    }

    public getHost(): string {
        return this.host;
    }
}

/**
 * Agent能力和状态接口
 */
export interface AgentCapabilities {
    name: string;
    treeId: string;
    available: boolean;
    lastTested: string;
    sampleResponse?: string;
    error?: string;
}

/**
 * 创建SimpleAgentInterface的工厂函数
 */
export function createSimpleAgent(treeId: string, name: string, host?: string): SimpleAgentInterface {
    return new SimpleAgentInterface(treeId, name, host);
}

/**
 * 批量创建多个agents
 */
export function createMultipleAgents(configs: Array<{treeId: string, name: string, host?: string}>): SimpleAgentInterface[] {
    return configs.map(config => createSimpleAgent(config.treeId, config.name, config.host));
}

/**
 * 测试多个agents的可用性
 */
export async function testAgentsHealth(agents: SimpleAgentInterface[]): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();
    
    const healthChecks = agents.map(async (agent) => {
        const isHealthy = await agent.healthCheck();
        results.set(agent.getName(), isHealthy);
        return { agent: agent.getName(), healthy: isHealthy };
    });

    const completed = await Promise.allSettled(healthChecks);
    
    completed.forEach((result, index) => {
        if (result.status === 'rejected') {
            results.set(agents[index].getName(), false);
        }
    });

    return results;
}