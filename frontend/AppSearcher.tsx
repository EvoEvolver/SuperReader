import React, { useState, useEffect, useRef } from 'react';
import {
    TextField,
    Button,
    Paper,
    Box,
    Typography,
    CircularProgress,
    List,
    ListItem,
    ListItemText,
    Chip,
} from '@mui/material';
import {worker_endpoint} from "./config";

interface QueryResponse {
    answer: string;
}

interface ProgressEvent {
    stage: string;
    iteration?: number;
    queueSize?: number;
    matchedCount?: number;
    message: string;
}

interface MatchedNode {
    id: string;
    title: string;
}

const QueryComponent: React.FC = () => {
    const [url, setUrl] = useState('');
    const [question, setQuestion] = useState('');
    const [answer, setAnswer] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [statusMessage, setStatusMessage] = useState<string>('');
    const [progress, setProgress] = useState<ProgressEvent | null>(null);
    const [matchedNodes, setMatchedNodes] = useState<MatchedNode[]>([]);
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
        setProgress(null);
        setMatchedNodes([]);

        try {
            // Create EventSource for SSE
            const encodedUrl = encodeURIComponent(url);
            const encodedQuestion = encodeURIComponent(question);
            const eventSource = new EventSource(
                `${worker_endpoint}/search_and_answer_stream?treeUrl=${encodedUrl}&question=${encodedQuestion}`
            );
            eventSourceRef.current = eventSource;

            // Handle status events
            eventSource.addEventListener('status', (event) => {
                const data = JSON.parse(event.data);
                setStatusMessage(data.message);
            });

            // Handle progress events
            eventSource.addEventListener('progress', (event) => {
                const data = JSON.parse(event.data);
                setProgress(data);
            });

            // Handle matched nodes events
            eventSource.addEventListener('nodes_matched', (event) => {
                const data = JSON.parse(event.data);
                setMatchedNodes(prev => [...prev, ...data.nodes]);
            });

            // Handle answer event
            eventSource.addEventListener('answer', (event) => {
                const data = JSON.parse(event.data);
                setAnswer(data.answer);
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
        <Box sx={{ maxWidth: 600, margin: '0 auto', padding: 3 }}>
            <Paper elevation={3} sx={{ padding: 3 }}>
                <Typography variant="h5" gutterBottom>
                    Ask a Question
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
                        {loading ? <CircularProgress size={24} color="inherit" /> : 'Get Answer'}
                    </Button>
                </form>

                {/* Status and Progress Section */}
                {loading && (
                    <Paper sx={{ mt: 3, p: 2, bgcolor: 'info.50' }}>
                        <Typography variant="subtitle2" color="primary" gutterBottom>
                            Status
                        </Typography>
                        {statusMessage && (
                            <Typography variant="body2" sx={{ mb: 1 }}>
                                {statusMessage}
                            </Typography>
                        )}
                        {progress && (
                            <Box sx={{ mt: 1 }}>
                                <Typography variant="body2" color="text.secondary">
                                    Iteration: {progress.iteration} | Queue: {progress.queueSize} | Matched: {progress.matchedCount}
                                </Typography>
                            </Box>
                        )}
                    </Paper>
                )}

                {/* Matched Nodes Section */}
                {matchedNodes.length > 0 && (
                    <Paper sx={{ mt: 2, p: 2, bgcolor: 'success.50' }}>
                        <Typography variant="subtitle2" color="success.main" gutterBottom>
                            Matched Nodes ({matchedNodes.length})
                        </Typography>
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1 }}>
                            {matchedNodes.map((node, index) => (
                                <Chip
                                    key={`${node.id}-${index}`}
                                    label={node.title || `Node ${index + 1}`}
                                    size="small"
                                    color="success"
                                    variant="outlined"
                                />
                            ))}
                        </Box>
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

export default QueryComponent;