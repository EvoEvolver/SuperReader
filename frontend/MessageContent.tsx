import React from 'react';
import { Box } from '@mui/material';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import DOMPurify from 'dompurify';

interface MessageContentProps {
    content: string;
    agentName: string;
}

const MessageContent: React.FC<MessageContentProps> = ({ content, agentName }) => {
    // Determine if this message should use Markdown rendering
    const shouldUseMarkdown = (agentName: string) => {
        return ['Discussion Analysis', 'Discussion Summary', 'Discussion Coordinator'].includes(agentName);
    };

    // Shared styles for both HTML and Markdown content
    const contentStyles = {
        '& h1': { fontSize: '1.5rem', fontWeight: 'bold', mt: 2, mb: 1 },
        '& h2': { fontSize: '1.3rem', fontWeight: 'bold', mt: 2, mb: 1 },
        '& h3': { fontSize: '1.1rem', fontWeight: 'bold', mt: 1.5, mb: 1 },
        '& h4': { fontSize: '1.05rem', fontWeight: 'bold', mt: 1.5, mb: 1 },
        '& h5': { fontSize: '1rem', fontWeight: 'bold', mt: 1, mb: 1 },
        '& h6': { fontSize: '0.95rem', fontWeight: 'bold', mt: 1, mb: 1 },
        '& p': { mb: 1, lineHeight: 1.6 },
        '& ul, & ol': { pl: 3, mb: 1 },
        '& li': { mb: 0.5 },
        '& blockquote': { 
            borderLeft: '4px solid #ddd', 
            pl: 2, 
            ml: 0, 
            fontStyle: 'italic',
            bgcolor: '#f9f9f9',
            py: 1,
            mb: 1
        },
        '& code': { 
            bgcolor: '#f5f5f5', 
            px: 0.5, 
            py: 0.25, 
            borderRadius: 1,
            fontFamily: 'monospace'
        },
        '& pre': { 
            bgcolor: '#f5f5f5', 
            p: 2, 
            borderRadius: 1, 
            overflow: 'auto',
            mb: 1
        },
        '& strong, & b': { fontWeight: 'bold' },
        '& em, & i': { fontStyle: 'italic' },
        '& a': { 
            color: 'primary.main', 
            textDecoration: 'none',
            '&:hover': { textDecoration: 'underline' }
        },
        '& table': { 
            borderCollapse: 'collapse', 
            width: '100%', 
            mb: 2,
            border: '1px solid #ddd'
        },
        '& th, & td': { 
            border: '1px solid #ddd', 
            p: 1, 
            textAlign: 'left' 
        },
        '& th': { 
            bgcolor: '#f5f5f5', 
            fontWeight: 'bold' 
        },
        '& hr': { 
            my: 2, 
            border: 'none', 
            borderTop: '1px solid #ddd' 
        }
    };

    if (shouldUseMarkdown(agentName)) {
        // Use Markdown rendering for Discussion Analysis, Summary, and Coordinator
        return (
            <Box sx={contentStyles}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {content}
                </ReactMarkdown>
            </Box>
        );
    } else {
        // Use HTML rendering for Agent responses
        // Sanitize HTML content to prevent XSS attacks
        const sanitizedHtml = DOMPurify.sanitize(content, {
            ALLOWED_TAGS: [
                'p', 'br', 'strong', 'b', 'em', 'i', 'u', 'span', 'div',
                'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
                'ul', 'ol', 'li',
                'a', 'img',
                'blockquote', 'code', 'pre',
                'table', 'thead', 'tbody', 'tr', 'th', 'td',
                'hr'
            ],
            ALLOWED_ATTR: [
                'href', 'target', 'rel', 'src', 'alt', 'title',
                'class', 'id', 'style'
            ],
            ALLOWED_SCHEMES: ['http', 'https', 'mailto'],
            KEEP_CONTENT: true
        });

        return (
            <Box 
                sx={contentStyles}
                dangerouslySetInnerHTML={{ __html: sanitizedHtml }} 
            />
        );
    }
};

export default MessageContent;