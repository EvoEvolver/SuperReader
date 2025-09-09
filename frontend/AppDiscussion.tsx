import React, { useState, useEffect, useRef } from 'react';
import {
    Box,
    Button,
    Typography,
    TextField,
    Paper,
    Card,
    CardContent,
    CardHeader,
    Avatar,
    Chip,
    CircularProgress,
    Alert,
    Select,
    MenuItem,
    FormControl,
    InputLabel,
    Divider,
    IconButton,
    Tooltip
} from '@mui/material';
import MessageContent from './MessageContent';
import {
    PlayArrow,
    Stop,
    Person,
    SmartToy,
    Download,
    Refresh
} from '@mui/icons-material';
import {
    DiscussionConfig,
    DiscussionMessage,
    DiscussionStatus,
    DiscussionHistory,
    initiateDiscussion,
    getDiscussionStatus,
    getDiscussionHistory,
    concludeDiscussion,
    validateTreeUrl,
    formatDiscussionMessage
} from './discussion-api';
import { extractTreeIdFromUrl } from './discussion-api';
import { listAgents, AgentInfo } from './agent-api';

interface AppDiscussionState {
    // Configuration
    topic: string;
    maxRounds: number;
    agentATreeUrl: string;
    agentBTreeUrl: string;
    agentAName: string;
    agentBName: string;
    agentAIcon: string | null;
    agentBIcon: string | null;
    
    // Discussion state
    discussionId: string | null;
    discussionStatus: DiscussionStatus | null;
    messages: DiscussionMessage[];
    
    // UI state
    isConfiguring: boolean;
    isLoading: boolean;
    error: string | null;
    isPolling: boolean;
}

const AppDiscussion: React.FC = () => {
    const [state, setState] = useState<AppDiscussionState>({
        topic: '',
        maxRounds: 5,
        agentATreeUrl: '',
        agentBTreeUrl: '',
        agentAName: 'Agent A',
        agentBName: 'Agent B',
        agentAIcon: null,
        agentBIcon: null,
        discussionId: null,
        discussionStatus: null,
        messages: [],
        isConfiguring: true,
        isLoading: false,
        error: null,
        isPolling: false
    });

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

    // Function to find agent icon by tree URL
    const findAgentIcon = async (treeUrl: string): Promise<string | null> => {
        try {
            const treeId = extractTreeIdFromUrl(treeUrl);
            if (!treeId) return null;
            
            const agents = await listAgents();
            const agent = agents.find(a => a.treeId === treeId);
            return agent?.iconUrl || null;
        } catch (error) {
            console.warn('Failed to fetch agent icon:', error);
            return null;
        }
    };

    // Auto-scroll to bottom when new messages arrive (disabled)
    // useEffect(() => {
    //     messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    // }, [state.messages]);

    // Polling for discussion updates
    useEffect(() => {
        if (state.isPolling && state.discussionId) {
            pollingIntervalRef.current = setInterval(async () => {
                try {
                    console.log(`[AppDiscussion] Polling discussion ${state.discussionId}`);
                    
                    // Only fetch discussion history, which includes both status and messages
                    const history = await getDiscussionHistory(state.discussionId!);
                    
                    console.log(`[AppDiscussion] Full history response:`, history);
                    console.log(`[AppDiscussion] Status from history:`, history.status);
                    console.log(`[AppDiscussion] Messages count:`, history.messages?.length || 0);
                    console.log(`[AppDiscussion] Discussion status:`, history.status?.status);
                    
                    // Format messages properly
                    const formattedMessages = history.messages?.map(formatDiscussionMessage) || [];
                    
                    setState(prev => ({
                        ...prev,
                        discussionStatus: history.status,
                        messages: formattedMessages
                    }));

                    // Stop polling if discussion is completed
                    if (history.status?.status === 'completed' || history.status?.status === 'concluded' || history.status?.status === 'error') {
                        console.log(`[AppDiscussion] Discussion finished with status: ${history.status.status}, stopping polling`);
                        setState(prev => ({ ...prev, isPolling: false }));
                    } else {
                        console.log(`[AppDiscussion] Discussion continues, status: ${history.status?.status}, round: ${history.status?.currentRound}/${history.status?.maxRounds}`);
                    }
                } catch (error) {
                    console.error('[AppDiscussion] Polling error:', error);
                    // Don't stop polling on single error, but log it
                }
            }, 3000); // Poll every 3 seconds
        }

        return () => {
            if (pollingIntervalRef.current) {
                clearInterval(pollingIntervalRef.current);
            }
        };
    }, [state.isPolling, state.discussionId]);

    const handleStartDiscussion = async () => {
        // Validation
        if (!state.topic.trim()) {
            setState(prev => ({ ...prev, error: 'Discussion topic is required' }));
            return;
        }

        if (!validateTreeUrl(state.agentATreeUrl)) {
            setState(prev => ({ ...prev, error: 'Agent A tree URL is invalid' }));
            return;
        }

        if (!validateTreeUrl(state.agentBTreeUrl)) {
            setState(prev => ({ ...prev, error: 'Agent B tree URL is invalid' }));
            return;
        }

        setState(prev => ({ ...prev, isLoading: true, error: null }));

        try {
            // Fetch agent icons before starting discussion
            const [agentAIcon, agentBIcon] = await Promise.all([
                findAgentIcon(state.agentATreeUrl),
                findAgentIcon(state.agentBTreeUrl)
            ]);

            setState(prev => ({
                ...prev,
                agentAIcon,
                agentBIcon
            }));

            const config: DiscussionConfig = {
                topic: state.topic,
                maxRounds: state.maxRounds,
                agentA: {
                    treeUrl: state.agentATreeUrl,
                    name: state.agentAName
                },
                agentB: {
                    treeUrl: state.agentBTreeUrl,
                    name: state.agentBName
                }
            };

            const result = await initiateDiscussion(config);
            
            setState(prev => ({
                ...prev,
                discussionId: result.discussionId,
                isConfiguring: false,
                isLoading: false,
                isPolling: true
            }));
        } catch (error) {
            setState(prev => ({
                ...prev,
                error: error instanceof Error ? error.message : 'Failed to start discussion',
                isLoading: false
            }));
        }
    };

    const handleConcludeDiscussion = async () => {
        if (!state.discussionId) return;

        setState(prev => ({ ...prev, isLoading: true }));

        try {
            await concludeDiscussion(state.discussionId);
            setState(prev => ({ 
                ...prev, 
                isPolling: false,
                isLoading: false 
            }));
        } catch (error) {
            setState(prev => ({
                ...prev,
                error: error instanceof Error ? error.message : 'Failed to conclude discussion',
                isLoading: false
            }));
        }
    };

    const handleResetDiscussion = () => {
        setState(prev => ({
            ...prev,
            discussionId: null,
            discussionStatus: null,
            messages: [],
            isConfiguring: true,
            isPolling: false,
            error: null,
            agentAIcon: null,
            agentBIcon: null
        }));
    };

    const handleExportHistory = () => {
        if (state.messages.length === 0) return;

        const exportData = {
            topic: state.topic,
            discussionId: state.discussionId,
            status: state.discussionStatus,
            messages: state.messages,
            exportedAt: new Date().toISOString()
        };

        const blob = new Blob([JSON.stringify(exportData, null, 2)], {
            type: 'application/json'
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `discussion-${state.discussionId}-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const getAgentAvatar = (agentName: string) => {
        if (agentName === 'Discussion Coordinator') {
            return <Avatar sx={{ bgcolor: 'warning.main' }}>🤝</Avatar>;
        } else if (agentName === 'Discussion Analysis') {
            return <Avatar sx={{ bgcolor: 'info.main' }}>📊</Avatar>;
        } else if (agentName === 'Discussion Summary') {
            return <Avatar sx={{ bgcolor: 'success.main' }}>📋</Avatar>;
        } else if (agentName === state.agentAName) {
            // Use Agent A's custom icon if available
            if (state.agentAIcon) {
                return <Avatar src={state.agentAIcon} sx={{ bgcolor: 'primary.main' }} />;
            }
            return <Avatar sx={{ bgcolor: 'primary.main' }}><Person /></Avatar>;
        } else {
            // Use Agent B's custom icon if available  
            if (state.agentBIcon) {
                return <Avatar src={state.agentBIcon} sx={{ bgcolor: 'secondary.main' }} />;
            }
            return <Avatar sx={{ bgcolor: 'secondary.main' }}><SmartToy /></Avatar>;
        }
    };

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'active': return 'success';
            case 'completed': return 'info';
            case 'concluded': return 'info';
            case 'error': return 'error';
            default: return 'default';
        }
    };

    if (state.isConfiguring) {
        return (
            <Box sx={{ p: 3, maxWidth: 800, mx: 'auto' }}>
                <Typography variant="h4" gutterBottom align="center">
                    Agent Discussion Setup
                </Typography>
                
                <Paper elevation={3} sx={{ p: 4, mt: 3 }}>
                    <Typography variant="h6" gutterBottom>
                        Discussion Configuration
                    </Typography>

                    <TextField
                        fullWidth
                        label="Discussion Topic"
                        value={state.topic}
                        onChange={(e) => setState(prev => ({ ...prev, topic: e.target.value }))}
                        placeholder="What should the agents discuss?"
                        sx={{ mb: 3 }}
                        multiline
                        rows={2}
                    />

                    <FormControl fullWidth sx={{ mb: 3 }}>
                        <InputLabel>Maximum Rounds</InputLabel>
                        <Select
                            value={state.maxRounds}
                            label="Maximum Rounds"
                            onChange={(e) => setState(prev => ({ ...prev, maxRounds: Number(e.target.value) }))}
                        >
                            <MenuItem value={3}>3 rounds</MenuItem>
                            <MenuItem value={5}>5 rounds</MenuItem>
                            <MenuItem value={7}>7 rounds</MenuItem>
                            <MenuItem value={10}>10 rounds</MenuItem>
                        </Select>
                    </FormControl>

                    <Typography variant="h6" gutterBottom sx={{ mt: 4 }}>
                        Agent Configuration
                    </Typography>

                    <Box sx={{ display: 'grid', gap: 3, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
                        <Box>
                            <Typography variant="subtitle1" gutterBottom>
                                Agent A
                            </Typography>
                            <TextField
                                fullWidth
                                label="Agent A Name"
                                value={state.agentAName}
                                onChange={(e) => setState(prev => ({ ...prev, agentAName: e.target.value }))}
                                sx={{ mb: 2 }}
                            />
                            <TextField
                                fullWidth
                                label="Tree URL"
                                value={state.agentATreeUrl}
                                onChange={(e) => setState(prev => ({ ...prev, agentATreeUrl: e.target.value }))}
                                placeholder="https://treer.ai/?id=..."
                                error={state.agentATreeUrl !== '' && !validateTreeUrl(state.agentATreeUrl)}
                                helperText={state.agentATreeUrl !== '' && !validateTreeUrl(state.agentATreeUrl) ? 'Invalid tree URL' : ''}
                            />
                        </Box>

                        <Box>
                            <Typography variant="subtitle1" gutterBottom>
                                Agent B
                            </Typography>
                            <TextField
                                fullWidth
                                label="Agent B Name"
                                value={state.agentBName}
                                onChange={(e) => setState(prev => ({ ...prev, agentBName: e.target.value }))}
                                sx={{ mb: 2 }}
                            />
                            <TextField
                                fullWidth
                                label="Tree URL"
                                value={state.agentBTreeUrl}
                                onChange={(e) => setState(prev => ({ ...prev, agentBTreeUrl: e.target.value }))}
                                placeholder="https://treer.ai/?id=..."
                                error={state.agentBTreeUrl !== '' && !validateTreeUrl(state.agentBTreeUrl)}
                                helperText={state.agentBTreeUrl !== '' && !validateTreeUrl(state.agentBTreeUrl) ? 'Invalid tree URL' : ''}
                            />
                        </Box>
                    </Box>

                    {state.error && (
                        <Alert severity="error" sx={{ mt: 3 }}>
                            {state.error}
                        </Alert>
                    )}

                    <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
                        <Button
                            variant="contained"
                            size="large"
                            startIcon={state.isLoading ? <CircularProgress size={20} /> : <PlayArrow />}
                            onClick={handleStartDiscussion}
                            disabled={state.isLoading}
                            sx={{ minWidth: 200 }}
                        >
                            {state.isLoading ? 'Starting...' : 'Start Discussion'}
                        </Button>
                    </Box>
                </Paper>
            </Box>
        );
    }

    return (
        <Box sx={{ p: 3, maxWidth: 1000, mx: 'auto' }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                <Typography variant="h4">
                    Discussion: {state.topic}
                </Typography>
                <Box sx={{ display: 'flex', gap: 1 }}>
                    <Tooltip title="Export History">
                        <IconButton onClick={handleExportHistory} disabled={state.messages.length === 0}>
                            <Download />
                        </IconButton>
                    </Tooltip>
                    <Tooltip title="Reset Discussion">
                        <IconButton onClick={handleResetDiscussion}>
                            <Refresh />
                        </IconButton>
                    </Tooltip>
                </Box>
            </Box>

            {/* Status Bar */}
            {state.discussionStatus && (
                <Paper elevation={1} sx={{ p: 2, mb: 3 }}>
                    <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
                        <Chip 
                            label={state.discussionStatus.status} 
                            color={getStatusColor(state.discussionStatus.status) as any}
                        />
                        <Typography variant="body2">
                            Round {state.discussionStatus.currentRound} of {state.discussionStatus.maxRounds}
                        </Typography>
                        <Typography variant="body2">
                            {state.discussionStatus.messageCount} messages
                        </Typography>
                        {state.discussionStatus.status === 'active' && (
                            <Button
                                size="small"
                                variant="outlined"
                                startIcon={<Stop />}
                                onClick={handleConcludeDiscussion}
                                disabled={state.isLoading}
                            >
                                Conclude
                            </Button>
                        )}
                    </Box>
                </Paper>
            )}

            {/* Messages */}
            <Box sx={{ height: '60vh', overflow: 'auto', mb: 2 }}>
                {/* Debug Info */}
                <Paper elevation={0} sx={{ p: 1, mb: 1, bgcolor: '#f5f5f5' }}>
                    <Typography variant="caption" color="text.secondary">
                        DEBUG: Messages: {state.messages.length}, Polling: {state.isPolling ? 'Yes' : 'No'}, Status: {state.discussionStatus?.status || 'none'}
                    </Typography>
                </Paper>

                {state.messages.length === 0 && state.isPolling && (
                    <Paper elevation={1} sx={{ p: 4, textAlign: 'center' }}>
                        <Typography color="text.secondary">
                            Discussion is starting... Please wait for agents to begin the conversation.
                        </Typography>
                        <CircularProgress sx={{ mt: 2 }} size={24} />
                    </Paper>
                )}

                {state.messages.length === 0 && !state.isPolling && (
                    <Paper elevation={1} sx={{ p: 4, textAlign: 'center' }}>
                        <Typography color="text.secondary">
                            No discussion content available.
                        </Typography>
                    </Paper>
                )}

                {state.messages.map((message, index) => (
                    <Card key={message.messageId || index} sx={{ mb: 2, boxShadow: 1 }}>
                        <CardHeader
                            avatar={getAgentAvatar(message.agentName)}
                            title={message.agentName}
                            subheader={`${new Date(message.timestamp).toLocaleString()}${message.roundNumber ? ` • Round ${message.roundNumber}` : ''}`}
                            sx={{ pb: 1 }}
                        />
                        <CardContent sx={{ pt: 0 }}>
                            <MessageContent 
                                content={message.content}
                                agentName={message.agentName}
                            />
                        </CardContent>
                    </Card>
                ))}

                {state.isPolling && (
                    <Box sx={{ display: 'flex', justifyContent: 'center', p: 2 }}>
                        <CircularProgress size={24} />
                        <Typography variant="body2" sx={{ ml: 2 }}>
                            Discussion in progress...
                        </Typography>
                    </Box>
                )}

                <div ref={messagesEndRef} />
            </Box>

            {state.error && (
                <Alert severity="error" sx={{ mt: 2 }}>
                    {state.error}
                </Alert>
            )}
        </Box>
    );
};

export default AppDiscussion;