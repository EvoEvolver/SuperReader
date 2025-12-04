
// make a function that converts a markdown to a preview of it by
// 1. find the key positions: headings, figures, tables (<table> tags)
// 2. show the -100 to +100 characters around each key position
// 3. return the preview as text string with position information

interface KeyPosition {
  type: 'heading' | 'figure' | 'table';
  start: number;
  end: number;
  content: string;
}

/**
 * Converts markdown to a preview text by extracting key positions
 * @param markdown The markdown content to preview
 * @param contextChars Number of characters to show around each key position (default: 100)
 * @returns Text string containing the preview with position information
 */
export function markdownToPreview(markdown: string, contextChars: number = 100): string {
  const keyPositions: KeyPosition[] = [];

  // Find headings (lines starting with #)
  const headingRegex = /^#{1,6}\s+.+$/gm;
  let match;
  while ((match = headingRegex.exec(markdown)) !== null) {
    keyPositions.push({
      type: 'heading',
      start: match.index,
      end: match.index + match[0].length,
      content: match[0]
    });
  }

  // Find figures (markdown image syntax: ![alt](url))
  const figureRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  while ((match = figureRegex.exec(markdown)) !== null) {
    keyPositions.push({
      type: 'figure',
      start: match.index,
      end: match.index + match[0].length,
      content: match[0]
    });
  }

  // Find tables (HTML <table> tags)
  const tableRegex = /<table[\s\S]*?<\/table>/gi;
  while ((match = tableRegex.exec(markdown)) !== null) {
    keyPositions.push({
      type: 'table',
      start: match.index,
      end: match.index + match[0].length,
      content: match[0]
    });
  }

  // Find markdown tables (lines with | characters)
  const markdownTableRegex = /(\|.+\|[\r\n]+)+/g;
  while ((match = markdownTableRegex.exec(markdown)) !== null) {
    keyPositions.push({
      type: 'table',
      start: match.index,
      end: match.index + match[0].length,
      content: match[0]
    });
  }

  // Sort by position
  keyPositions.sort((a, b) => a.start - b.start);

  // Merge overlapping positions
  const mergedPositions: KeyPosition[] = [];
  for (const pos of keyPositions) {
    const contextStart = Math.max(0, pos.start - contextChars);
    const contextEnd = Math.min(markdown.length, pos.end + contextChars);

    if (mergedPositions.length === 0) {
      mergedPositions.push({ ...pos, start: contextStart, end: contextEnd });
    } else {
      const last = mergedPositions[mergedPositions.length - 1];
      if (contextStart <= last.end) {
        // Overlapping, merge them
        last.end = Math.max(last.end, contextEnd);
      } else {
        mergedPositions.push({ ...pos, start: contextStart, end: contextEnd });
      }
    }
  }

  // Generate text preview with position information
  const textParts: string[] = [];

  for (let i = 0; i < mergedPositions.length; i++) {
    const pos = mergedPositions[i];
    const excerpt = markdown.substring(pos.start, pos.end);

    // Add position header
    textParts.push(`[${pos.type.toUpperCase()}] Position ${pos.start}-${pos.end}:`);

    // Add ellipsis if not at start
    const prefix = pos.start > 0 ? '...' : '';
    const suffix = pos.end < markdown.length ? '...' : '';

    textParts.push(prefix + excerpt + suffix);

    // Add separator between sections
    if (i < mergedPositions.length - 1) {
      textParts.push('\n---\n');
    }
  }

  return textParts.join('\n');
}
