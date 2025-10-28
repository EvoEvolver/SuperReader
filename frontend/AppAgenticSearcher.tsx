import React, { useState, useEffect, useRef } from 'react';
import {
    TextField,
    Button,
    Paper,
    Box,
    Typography,
    CircularProgress,
    Chip,
    List,
    ListItem,
    ListItemText,
    Divider,
} from '@mui/material';
import {worker_endpoint} from "./config";

interface ToolCall {
    tool: string;
    nodeId?: string;
    nodeTitle?: string;
    childrenCount?: number;
    contentLength?: number;
    parentId?: string;
    parentTitle?: string;
}

interface RelevantNode {
    nodeId: string;
    title: string;
    reason: string;
    totalRelevantNodes: number;
}

interface StatusEvent {
    stage: string;
    message: string;
    stats?: {
        nodes_explored: number;
        tool_calls: number;
        search_iterations: number;
    };
}

const AgenticSearchComponent: React.FC = () => {
    const [url, setUrl] = useState('');
    const [question, setQuestion] = useState('');
    const [answer, setAnswer] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [statusMessage, setStatusMessage] = useState<string>('');
    const [toolCalls, setToolCalls] = useState<ToolCall[]>([]);
    const [relevantNodes, setRelevantNodes] = useState<RelevantNode[]>([]);
    const eventSourceRef = useRef<EventSource | null>(null);

    // Extract tree parameter from URL on component mount
    useEffect(() => {
        const urlParams = new URLSearchParams(window.location.search);
        const treeParam = urlParams.get('tree');
        if (treeParam) {
            setUrl(treeParam);
        }
    }, []);

    // Cleanup EventSource on unmount
    useEffect(() => {
        return () => {
            if (eventSourceRef.current) {
                eventSourceRef.current.close();
            }
        };
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        // Validate URL starts with https://treer.ai
        if (!url.startsWith('https://treer.ai')) {
            setAnswer('Error: URL must start with https://treer.ai');
            return;
        }

        // Close any existing EventSource
        if (eventSourceRef.current) {
            eventSourceRef.current.close();
        }

        // Reset state
        setLoading(true);
        setAnswer(null);
        setStatusMessage('');
        setToolCalls([]);
        setRelevantNodes([]);

        try {
            // Create EventSource for SSE
            const encodedUrl = encodeURIComponent(url);
            const encodedQuestion = encodeURIComponent(question);
            const eventSource = new EventSource(
                `${worker_endpoint}/agentic_search_stream?treeUrl=${encodedUrl}&question=${encodedQuestion}`
            );
            eventSourceRef.current = eventSource;

            // Handle status events
            eventSource.addEventListener('status', (event) => {
                const data: StatusEvent = JSON.parse(event.data);
                setStatusMessage(data.message);
            });

            // Handle progress events
            eventSource.addEventListener('progress', (event) => {
                const data = JSON.parse(event.data);
                setStatusMessage(data.message);
            });

            // Handle tool call events
            eventSource.addEventListener('tool_call', (event) => {
                const data: ToolCall = JSON.parse(event.data);
                setToolCalls(prev => [...prev, data]);
            });

            // Handle node marked relevant events
            eventSource.addEventListener('node_marked_relevant', (event) => {
                const data: RelevantNode = JSON.parse(event.data);
                setRelevantNodes(prev => [...prev, data]);
            });

            // Handle answer event
            eventSource.addEventListener('answer', (event) => {
                const data = JSON.parse(event.data);
                setAnswer(data.answer);
            });

            // Handle metadata event
            eventSource.addEventListener('metadata', (event) => {
                const data = JSON.parse(event.data);
                console.log('Search metadata:', data);
            });

            // Handle completion
            eventSource.addEventListener('complete', (event) => {
                setLoading(false);
                eventSource.close();
            });

            // Handle errors
            eventSource.addEventListener('error', (event) => {
                const data = JSON.parse((event as MessageEvent).data || '{}');
                setAnswer(data.message || 'Error occurred while fetching the answer.');
                setLoading(false);
                eventSource.close();
            });

            eventSource.onerror = (error) => {
                console.error('EventSource error:', error);
                setAnswer('Connection error occurred.');
                setLoading(false);
                eventSource.close();
            };
        } catch (error) {
            setAnswer('Error occurred while setting up the connection.');
            setLoading(false);
        }
    };

    return (
        <Box sx={{ maxWidth: 800, margin: '0 auto', padding: 3 }}>
            <Paper elevation={3} sx={{ padding: 3 }}>
                <Typography variant="h5" gutterBottom>
                    Agentic Search (AI-Powered)
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    Uses an AI agent to intelligently explore the tree and find relevant information
                </Typography>

                <form onSubmit={handleSubmit}>
                    <TextField
                        fullWidth
                        label="URL"
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        margin="normal"
                        required
                        placeholder="https://treer.ai/..."
                        helperText="URL to the tree to search"
                    />

                    <TextField
                        fullWidth
                        label="Question"
                        value={question}
                        onChange={(e) => setQuestion(e.target.value)}
                        margin="normal"
                        required
                        multiline
                        rows={2}
                    />

                    <Button
                        type="submit"
                        variant="contained"
                        color="primary"
                        fullWidth
                        sx={{ mt: 2 }}
                        disabled={loading || !url || !question}
                    >
                        {loading ? <CircularProgress size={24} color="inherit" /> : 'Search with AI Agent'}
                    </Button>
                </form>

                {/* Status Section */}
                {loading && statusMessage && (
                    <Paper sx={{ mt: 3, p: 2, bgcolor: 'info.50' }}>
                        <Typography variant="subtitle2" color="primary" gutterBottom>
                            Status
                        </Typography>
                        <Typography variant="body2">
                            {statusMessage}
                        </Typography>
                    </Paper>
                )}

                {/* Tool Calls Section */}
                {toolCalls.length > 0 && (
                    <Paper sx={{ mt: 2, p: 2, bgcolor: 'grey.50' }}>
                        <Typography variant="subtitle2" gutterBottom>
                            Agent Actions ({toolCalls.length})
                        </Typography>
                        <List dense sx={{ maxHeight: 300, overflow: 'auto' }}>
                            {toolCalls.slice(-10).map((call, index) => (
                                <React.Fragment key={index}>
                                    <ListItem>
                                        <ListItemText
                                            primary={
                                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                                    <Chip label={call.tool} size="small" color="default" />
                                                    {call.nodeTitle && (
                                                        <Typography variant="body2">
                                                            {call.nodeTitle}
                                                        </Typography>
                                                    )}
                                                </Box>
                                            }
                                            secondary={
                                                call.childrenCount !== undefined
                                                    ? `Found ${call.childrenCount} children`
                                                    : call.contentLength !== undefined
                                                    ? `Read ${call.contentLength} characters`
                                                    : call.parentTitle
                                                    ? `Parent: ${call.parentTitle}`
                                                    : undefined
                                            }
                                        />
                                    </ListItem>
                                    {index < toolCalls.slice(-10).length - 1 && <Divider />}
                                </React.Fragment>
                            ))}
                        </List>
                        {toolCalls.length > 10 && (
                            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                                Showing last 10 of {toolCalls.length} actions
                            </Typography>
                        )}
                    </Paper>
                )}

                {/* Relevant Nodes Section */}
                {relevantNodes.length > 0 && (
                    <Paper sx={{ mt: 2, p: 2, bgcolor: 'success.50' }}>
                        <Typography variant="subtitle2" color="success.main" gutterBottom>
                            Relevant Nodes Found ({relevantNodes.length})
                        </Typography>
                        <List dense>
                            {relevantNodes.map((node, index) => (
                                <React.Fragment key={index}>
                                    <ListItem>
                                        <ListItemText
                                            primary={
                                                <Typography variant="body2" fontWeight="bold">
                                                    {node.title}
                                                </Typography>
                                            }
                                            secondary={
                                                <Typography variant="caption" color="text.secondary">
                                                    Reason: {node.reason}
                                                </Typography>
                                            }
                                        />
                                    </ListItem>
                                    {index < relevantNodes.length - 1 && <Divider />}
                                </React.Fragment>
                            ))}
                        </List>
                    </Paper>
                )}

                {/* Answer Section */}
                {answer && (
                    <Paper sx={{ mt: 3, p: 2, bgcolor: 'grey.50' }}>
                        <Typography variant="subtitle2" gutterBottom>
                            Answer
                        </Typography>
                        <span dangerouslySetInnerHTML={{__html: answer}}></span>
                    </Paper>
                )}
            </Paper>
        </Box>
    );
};

export default AgenticSearchComponent;
