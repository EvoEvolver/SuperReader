import { tool } from 'ai';
import { z } from 'zod';
import { generateText, stepCountIs } from 'ai';
import { openai } from '@ai-sdk/openai';

export interface AgenticReaderToolsContext {
  fullContent: string;
  emitEvent?: (event: string, data: any) => void;
  stats?: {
    tool_calls: number;
    content_reads: number;
    figure_analyses: number;
  };
  memo?: { current: string };
  maxIterations?: number;
  model?: string;
}

export function createAgenticReaderTools(context: AgenticReaderToolsContext) {
  const { fullContent, emitEvent, stats, memo } = context;

  return {
    readContent: tool({
      description: 'Read content from the document between two positions. Returns text from startPosition to endPosition. Use this to explore specific parts of the document.',
      inputSchema: z.object({
        startPosition: z.number().describe('The starting character position in the document (0-indexed, inclusive)'),
        endPosition: z.number().describe('The ending character position in the document (0-indexed, exclusive)'),
      }),
      execute: async ({ startPosition, endPosition }) => {
        if (stats) {
          stats.tool_calls++;
          stats.content_reads++;
        }

        if (emitEvent) {
          emitEvent('tool_call', {
            tool: 'readContent',
            startPosition,
            endPosition,
          });
        }

        // Validate positions
        if (startPosition < 0 || startPosition > fullContent.length) {
          return {
            success: false,
            error: `Invalid startPosition ${startPosition}. Document length is ${fullContent.length} characters.`,
          };
        }

        if (endPosition < 0 || endPosition > fullContent.length) {
          return {
            success: false,
            error: `Invalid endPosition ${endPosition}. Document length is ${fullContent.length} characters.`,
          };
        }

        if (startPosition >= endPosition) {
          return {
            success: false,
            error: `startPosition (${startPosition}) must be less than endPosition (${endPosition}).`,
          };
        }

        const rangeSize = endPosition - startPosition;
        const LARGE_RANGE_THRESHOLD = 10000; // Characters

        // Extract content normally if range is reasonable
        // If too long, only return the beginning and end with ellipsis

        let content: string;
        if (rangeSize > LARGE_RANGE_THRESHOLD) {
          const snippetSize = Math.floor(LARGE_RANGE_THRESHOLD) - 100; // Leave room for ellipsis
          const newEndPos = startPosition + snippetSize
          const snippet = fullContent.slice(startPosition, newEndPos);
          content = `${snippet} [...content truncated... Only showing position to ${newEndPos}]`;
        } else {
          content = fullContent.slice(startPosition, endPosition);
        }

        if (emitEvent) {
          emitEvent('content_read', {
            startPosition,
            endPosition,
            contentLength: content.length,
          });
        }

        return {
          success: true,
          content,
          summarized: false,
          metadata: {
            startPosition,
            endPosition,
            contentLength: content.length,
            totalDocumentLength: fullContent.length,
            hasMoreBefore: startPosition > 0,
            hasMoreAfter: endPosition < fullContent.length,
          },
        };
      },
    }),

    readFigure: tool({
      description: 'Analyze a figure/image using visual AI. Provide an image URL and a query to ask specific questions about the figure.',
      inputSchema: z.object({
        imageUrl: z.string().describe('The URL of the image to analyze'),
        query: z.string().describe('The question or analysis request for the figure (e.g., "What does this graph show?", "Describe the structure in this diagram")'),
      }),
      execute: async ({ imageUrl, query }) => {
        if (stats) {
          stats.tool_calls++;
          stats.figure_analyses++;
        }

        if (emitEvent) {
          emitEvent('tool_call', {
            tool: 'readFigure',
            imageUrl,
            query,
          });
        }

        try {
          // Use vision model to analyze the figure
          const result = await generateText({
            model: openai('gpt-5-mini'), // Use vision-capable model
            messages: [
              {
                role: 'user',
                content: [
                  {
                    type: 'text',
                    text: `Analyze this figure and answer the following query: ${query}
                    
                    Notice that the query may contain information that does not exist in the figure. In that case, you should explain what is inside the figure and try to extract related information only from the figure itself. Do not make up any information that is not present in the figure.
                    `,
                  },
                  {
                    type: 'image',
                    image: imageUrl, // Can be URL or base64
                  },
                ],
              },
            ],
          });

          if (emitEvent) {
            emitEvent('figure_analyzed', {
              imageUrl,
              query,
              result: result.text,
              analysisLength: result.text.length,
            });
          }

          return {
            success: true,
            imageUrl,
            query,
            analysis: result.text,
          };
        } catch (error) {
          console.error(`Error analyzing figure at ${imageUrl}:`, error);
          return {
            success: false,
            error: `Failed to analyze figure: ${error.message}`,
          };
        }
      },
    }),

    /*readTable: tool({
      description: 'Extract and convert a table from an image into HTML format. Provide an image URL containing a table.',
      inputSchema: z.object({
        imageUrl: z.string().describe('The URL of the image containing the table to extract'),
      }),
      execute: async ({ imageUrl }) => {
        if (stats) {
          stats.tool_calls++;
        }

        if (emitEvent) {
          emitEvent('tool_call', {
            tool: 'readTable',
            imageUrl,
          });
        }

        try {
          // Use vision model to extract table data
          const result = await generateText({
            model: openai('gpt-5-mini'), // Use vision-capable model
            messages: [
              {
                role: 'user',
                content: [
                  {
                    type: 'text',
                    text: `Extract the table from this image and convert it to HTML format.

                    Requirements:
                    - Return ONLY the HTML table code (starting with <table> and ending with </table>)
                    - Preserve the table structure, including headers, rows, and columns
                    - Maintain the data accuracy from the original table
                    - Use proper HTML table tags: <table>, <thead>, <tbody>, <tr>, <th>, <td>
                    - Do not include any additional text, explanations, or markdown formatting
                    - If the image does not contain a table, respond with an error message`,
                  },
                  {
                    type: 'image',
                    image: imageUrl,
                  },
                ],
              },
            ],
          });

          if (emitEvent) {
            emitEvent('table_extracted', {
              imageUrl,
              htmlLength: result.text.length,
            });
          }

          return {
            success: true,
            imageUrl,
            tableHtml: result.text,
          };
        } catch (error) {
          console.error(`Error extracting table from ${imageUrl}:`, error);
          return {
            success: false,
            error: `Failed to extract table: ${error.message}`,
          };
        }
      },
    }),*/

    searchContent: tool({
      description: 'Search for content in the document using regex patterns. Returns the positions where matches are found.',
      inputSchema: z.object({
        searchPattern: z.string().describe('Regex pattern to search for in the document (e.g., "\\\\bprotein\\\\b", "temperature.*°C", etc.)'),
        maxResults: z.number().optional().describe('Maximum number of results to return (default: 5)'),
        flags: z.string().optional().describe('Regex flags (default: "gi" for global case-insensitive). Common flags: g=global, i=case-insensitive, m=multiline'),
      }),
      execute: async ({ searchPattern, maxResults = 5, flags = 'gi' }) => {
        if (stats) {
          stats.tool_calls++;
        }

        if (emitEvent) {
          emitEvent('tool_call', {
            tool: 'searchContent',
            searchPattern,
            maxResults,
            flags,
          });
        }

        try {
          // Create regex from pattern
          const regex = new RegExp(searchPattern, flags);
          const results: Array<{ position: number; context: string; match: string }> = [];

          let match: RegExpExecArray | null;
          while (results.length < maxResults && (match = regex.exec(fullContent)) !== null) {
            const foundPos = match.index;
            const matchedText = match[0];

            // Get context around the found position
            const contextStart = Math.max(0, foundPos - 50);
            const contextEnd = Math.min(fullContent.length, foundPos + matchedText.length + 50);
            const context = fullContent.slice(contextStart, contextEnd);

            results.push({
              position: foundPos,
              match: matchedText,
              context: `...${context}...`,
            });

            // Prevent infinite loop for zero-width matches
            if (match.index === regex.lastIndex) {
              regex.lastIndex++;
            }
          }

          // Check if there are more results
          const hasMore = regex.exec(fullContent) !== null;

          if (emitEvent) {
            emitEvent('search_complete', {
              searchPattern,
              resultsFound: results.length,
            });
          }

          return {
            success: true,
            searchPattern,
            flags,
            resultsFound: results.length,
            results,
            hasMore,
          };
        } catch (error) {
          console.error(`Error in regex search:`, error);
          return {
            success: false,
            error: `Invalid regex pattern: ${error.message}`,
          };
        }
      },
    }),

    updateMemo: tool({
      description: 'Update the memo to track your progress and plan your next actions. The memo will be appended to your context to help you stay organized.',
      inputSchema: z.object({
        memoContent: z.string().describe('The updated memo content as a string. Format it clearly with tasks and their status.'),
      }),
      execute: async ({ memoContent }) => {
        if (stats) {
          stats.tool_calls++;
        }

        if (emitEvent) {
          emitEvent('tool_call', {
            tool: 'updateMemo',
            memoLength: memoContent.length,
          });
        }

        // Update the shared memo state
        if (memo) {
          memo.current = memoContent;
        }

        if (emitEvent) {
          emitEvent('memo_updated', {
            memoLength: memoContent.length,
            memoContent: memoContent
          });
        }

        return {
          success: true,
          message: 'Memo updated successfully',
          memoLength: memoContent.length,
        };
      },
    })
  };
}
