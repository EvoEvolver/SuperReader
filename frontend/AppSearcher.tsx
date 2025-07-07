import React, { useState } from 'react';
import {
    TextField,
    Button,
    Paper,
    Box,
    Typography,
    CircularProgress,
} from '@mui/material';
import {worker_endpoint} from "./config";

interface QueryResponse {
    answer: string;
}

const QueryComponent: React.FC = () => {
    const [url, setUrl] = useState('');
    const [question, setQuestion] = useState('');
    const [answer, setAnswer] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    const getAnswer = async (url: string, question: string): Promise<QueryResponse> => {
        const response = await fetch(worker_endpoint+'/search_and_answer', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                question: question,
                treeUrl: url
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to fetch answer');
        }

        return response.json();
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            const response = await getAnswer(url, question);
            setAnswer(response.answer);
        } catch (error) {
            setAnswer('Error occurred while fetching the answer.');
        } finally {
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

                {answer && (
                    <Paper sx={{ mt: 3, p: 2, bgcolor: 'grey.50' }}>
                        <span dangerouslySetInnerHTML={{__html: answer}}></span>
                    </Paper>
                )}
            </Paper>
        </Box>
    );
};

export default QueryComponent;