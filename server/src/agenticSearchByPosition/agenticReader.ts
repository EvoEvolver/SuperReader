import { generateText, stepCountIs } from 'ai';
import { openai } from '@ai-sdk/openai';
import { createAgenticReaderTools } from './agenticReaderTools';
import { markdownToPreview } from './markdownPreview';

export interface AgenticReaderOptions {
  max_iterations?: number;
  model?: string;
  include_metadata?: boolean;
}

export interface AgenticReaderResult {
  answer: string;
  metadata?: {
    processing_time_ms: number;
    stats: {
      tool_calls: number;
      content_reads: number;
      figure_analyses: number;
      search_iterations: number;
    };
  };
}

/**
 * Agentic reader with event streaming for real-time progress updates
 * @param question - The question to answer about the document
 * @param emitEvent - Callback function to emit events
 * @param options - Configuration options
 */
export async function agenticReaderWithEvents(
    question: string,
    markdownContent: string,
    emitEvent: (event: string, data: any) => void,
    options: AgenticReaderOptions = {}
): Promise<void> {
  const startTime = Date.now();
  const stats = {
    tool_calls: 0,
    content_reads: 0,
    figure_analyses: 0,
    search_iterations: 0,
  };

  // Initialize memo state
  const memo = { current: '' };

  const {
    max_iterations,
    model = 'gpt-5-mini',
    include_metadata = false,
  } = options;
  try {
    emitEvent('status', {
      stage: 'starting',
      message: 'Initializing agentic reader...',
    });

    emitEvent('status', {
      stage: 'document_loaded',
      message: `Document loaded: ${markdownContent.length} characters`,
      documentLength: markdownContent.length,
    });

    // Generate markdown preview
    const markdownPreview = markdownToPreview(markdownContent);

    // Create tools for the agent
    const tools = createAgenticReaderTools({
      fullContent: markdownContent,
      stats,
      emitEvent,
      memo,
      maxIterations: max_iterations,
      model,
    });


    // Create the system prompt
    const systemPrompt = `You are an intelligent document reading agent designed to answer questions by exploring a document strategically.

QUESTION TO ANSWER: "${question}"

YOUR TASK:
Explore the document intelligently to find information that answers the user's question. You have the following tools:

- **readContent**: Read content from starting position to ending position in the document
- **readFigure**: Analyze figures using visual AI by providing an image URL and query
- **searchContent**: Search the position of a specific text in the document
- **updateMemo**: Update your memo to note important information or keep track of your plan

STRATEGY:
- Start with broad ranges using readContent to get hierarchical summaries, then drill down into specific sections
- Use readContent to explore promising chunks in whole based on the summaries below
- If a task is too complex, break it down using updateMemo to keep track of your plan
- If you find image URLs in the content and need to analyze them, use readFigure with the URL

DOCUMENT CHUNKS AND SUMMARIES:
Below are summaries of different sections of the document to help you navigate. You should use readContent to read the full content of the most relevant chunks based on these summaries.

${markdownPreview}

When you're ready to provide the final answer, include it in your last response with clear explanations and citations.`;

    emitEvent('status', {
      stage: 'exploring',
      message: 'Agent is exploring the document...',
    });

    // Run the agent
    const result = await generateText({
      model: openai(model),
      tools,
      system: systemPrompt,
      prompt: `Begin exploring the document to answer the question: "${question}". Start by getting document info and searching for relevant content.`,
      stopWhen: stepCountIs(max_iterations),
      prepareStep: async ({ messages }) => {
        // Keep only recent messages to stay within context limits
        let processedMessages = messages;

        if (messages.length > 30) {
          processedMessages = [
            messages[0], // Keep system message
            ...messages.slice(-30), // Keep last 30 messages
          ];
          console.log(processedMessages);
        }

        // Append memo as the last message if it exists
        if (memo.current) {
          return {
            messages: [
              ...processedMessages,
              {
                role: 'user',
                content: `CURRENT MEMO:\n${memo.current}`,
              },
            ],
          };
        }

        return {
          messages: processedMessages,
        };
      },
    });

    stats.search_iterations = result.steps.length;

    emitEvent('status', {
      stage: 'exploration_complete',
      message: `Agent completed exploration in ${result.steps.length} steps`,
      stats,
    });

    emitEvent('answer', {
      answer: result.text,
      usage: result.usage,
    });

    if (include_metadata) {
      emitEvent('metadata', {
        processing_time_ms: Date.now() - startTime,
        stats,
      });
    }

    emitEvent('complete', {
      message: 'Agentic reading completed successfully',
    });
  } catch (error) {
    console.error('[AgenticReaderWithEvents] Error during agentic reading:', error);
    emitEvent('error', {
      message: error.message || 'An error occurred during reading',
    });
  }
}
