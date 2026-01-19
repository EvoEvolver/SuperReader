import { generateText, stepCountIs } from 'ai';
import { openai } from '@ai-sdk/openai';
import { createAgenticReaderTools } from './agenticReaderTools';
import { markdownToPreview } from './markdownPreview';

export interface AgenticReaderOptions {
  max_iterations?: number;
  model?: string;
  include_metadata?: boolean;
}
import { encoding_for_model } from "tiktoken";


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
    markdownContentOrContents: string | string[],
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

    // Normalize to multiple documents (IDs start at 1)
    const contentsArray = Array.isArray(markdownContentOrContents)
      ? markdownContentOrContents
      : [markdownContentOrContents];

    const documents = contentsArray.map((content, idx) => ({ id: idx + 1, content }));

    emitEvent('status', {
      stage: 'documents_loaded',
      message: `Loaded ${documents.length} document(s)`
    });

    for (const doc of documents) {
      emitEvent('status', {
        stage: 'document_loaded',
        message: `Document ${doc.id} loaded: ${doc.content.length} characters`,
        documentId: doc.id,
        documentLength: doc.content.length,
      });
    }

    // Generate markdown previews for all documents
    const previewsArray = documents.map((doc) => ({
      docId: doc.id,
      length: doc.content.length,
      preview: markdownToPreview(doc.content),
    }));
    const allPreviews = previewsArray
      .map((p) => `DOCUMENT ${p.docId} PREVIEW (length ${p.length} chars):\n${p.preview}`)
      .join('\n\n');

    emitEvent('documents_preview', {
      previews: previewsArray,
    });

    // Create tools for the agent
    const tools = createAgenticReaderTools({
      documents,
      stats,
      emitEvent,
      memo,
      maxIterations: max_iterations,
      model,
    });


    // Create the system prompt
    const systemPrompt = `You are an intelligent document reading agent designed to answer questions by exploring one or more documents strategically.

QUESTION TO ANSWER: "${question}"

YOUR TASK:
Explore the available documents intelligently to find information that answers the user's question. You have the following tools:

- readContent(docId, startPosition, endPosition): Read content from a specific document between two positions. Always include docId (e.g., 1, 2).
- **readFigure**: Analyze figures using visual AI by providing an image URL and query
- searchContent(docId, searchPattern, ...): Search for a regex pattern within a specific document. Always include docId.
- **updateMemo**: Update your memo to note important information or keep track of your plan. For example, after finishing reading one document, you need to note key conclusion in the memo before go to the next document.

STRATEGY:
- Start with broad ranges using readContent to get hierarchical summaries, then drill down into specific sections
- Use readContent to explore promising chunks in whole based on the summaries below
- If a task is too complex, break it down using updateMemo to keep track of your plan
- If you find image URLs in the content and need to analyze them, use readFigure with the URL

DOCUMENTS AND PREVIEWS:
Below are previews of all available documents. Use these to pick which docId to explore with readContent/searchContent.

${allPreviews}

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

        if (messages.length > 50) {
          processedMessages = [
            messages[0], // Keep system message
            ...messages.slice(-50), // Keep the last 50 messages
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

    //Returns the number of tokens in a text string
    function numTokensFromString(message: string) {
      const encoder = encoding_for_model("gpt-5");
      const tokens = encoder.encode(message);
      encoder.free();
      return tokens.length;
    }

    // Compute token stats per document
    const markdownLengthTokensByDoc = documents.map((d) => ({
      docId: d.id,
      tokens: numTokensFromString(d.content),
      length: d.content.length,
    }));
    const totalMarkdownLengthTokens = markdownLengthTokensByDoc.reduce((acc, d) => acc + d.tokens, 0);

    emitEvent('answer', {
      answer: result.text,
      usage: result.usage,
      markdownLengthTokensByDoc,
      totalMarkdownLengthTokens,
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
