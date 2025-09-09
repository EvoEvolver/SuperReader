import React, { useState, useEffect } from 'react';
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
    CircularProgress,
    Alert,
    Chip,
    Divider,
    IconButton,
    Tooltip,
    Grid,
    Accordion,
    AccordionSummary,
    AccordionDetails,
    List,
    ListItem,
    ListItemText,
    ListItemSecondaryAction
} from '@mui/material';
import {
    Add,
    Send,
    Delete,
    ExpandMore,
    Link,
    Psychology,
    SmartToy,
    ContentCopy,
    Refresh
} from '@mui/icons-material';
import MessageContent from './MessageContent';
import {
    createAgent,
    getAgentInfo,
    testAgent,
    listAgents,
    deleteAgent,
    generateAgentUrl,
    AgentInfo,
    AgentTestResponse,
    AgentCreationResult
} from './agent-api';
import { validateTreeUrl } from './discussion-api';

interface AgentGeneratorState {
    // Creation form
    treeUrl: string;
    paperTitle: string;
    iconUrl: string;
    isCreating: boolean;
    
    // Current agent
    currentAgent: AgentInfo | null;
    
    // Testing
    testQuestion: string;
    testResponse: AgentTestResponse | null;
    isTesting: boolean;
    
    // Agents list
    agents: AgentInfo[];
    isLoadingAgents: boolean;
    
    // Error handling
    error: string | null;
    success: string | null;
}

const AppAgentGenerator: React.FC = () => {
    const [state, setState] = useState<AgentGeneratorState>({
        treeUrl: '',
        paperTitle: '',
        iconUrl: '',
        isCreating: false,
        currentAgent: null,
        testQuestion: '',
        testResponse: null,
        isTesting: false,
        agents: [],
        isLoadingAgents: false,
        error: null,
        success: null
    });

    // Load agents on component mount
    useEffect(() => {
        loadAgents();
    }, []);

    const loadAgents = async () => {
        setState(prev => ({ ...prev, isLoadingAgents: true, error: null }));
        
        try {
            const agents = await listAgents();
            setState(prev => ({ 
                ...prev, 
                agents, 
                isLoadingAgents: false 
            }));
        } catch (error) {
            setState(prev => ({ 
                ...prev, 
                error: error instanceof Error ? error.message : 'Failed to load agents',
                isLoadingAgents: false 
            }));
        }
    };

    const handleCreateAgent = async () => {
        // Validation
        if (!state.treeUrl.trim()) {
            setState(prev => ({ ...prev, error: 'Tree URL is required' }));
            return;
        }

        if (!validateTreeUrl(state.treeUrl)) {
            setState(prev => ({ ...prev, error: 'Invalid tree URL format' }));
            return;
        }

        if (!state.paperTitle.trim()) {
            setState(prev => ({ ...prev, error: 'Paper title is required' }));
            return;
        }

        setState(prev => ({ ...prev, isCreating: true, error: null, success: null }));

        try {
            const createResult = await createAgent(state.treeUrl, state.paperTitle, 15, state.iconUrl);
            
            // Get full agent info
            const agentInfo = await getAgentInfo(createResult.treeId);
            
            // Generate appropriate success message
            const successMessage = createResult.status === 'existing' 
                ? `Agent already exists for this paper: ${agentInfo.agentUrl}`
                : `Agent created successfully! Agent URL: ${agentInfo.agentUrl}`;

            setState(prev => ({
                ...prev,
                currentAgent: agentInfo,
                isCreating: false,
                success: successMessage,
                treeUrl: '',
                paperTitle: '',
                iconUrl: ''
            }));

            // Reload agents list
            await loadAgents();

        } catch (error) {
            setState(prev => ({
                ...prev,
                error: error instanceof Error ? error.message : 'Failed to create agent',
                isCreating: false
            }));
        }
    };

    const handleTestAgent = async () => {
        if (!state.currentAgent || !state.testQuestion.trim()) {
            setState(prev => ({ ...prev, error: 'Please select an agent and enter a question' }));
            return;
        }

        setState(prev => ({ ...prev, isTesting: true, error: null }));

        try {
            const response = await testAgent(state.currentAgent.treeId, state.testQuestion);
            setState(prev => ({
                ...prev,
                testResponse: response,
                isTesting: false,
                testQuestion: ''
            }));
        } catch (error) {
            setState(prev => ({
                ...prev,
                error: error instanceof Error ? error.message : 'Failed to test agent',
                isTesting: false
            }));
        }
    };

    const handleSelectAgent = async (treeId: string) => {
        try {
            setState(prev => ({ ...prev, error: null }));
            const agentInfo = await getAgentInfo(treeId);
            setState(prev => ({ 
                ...prev, 
                currentAgent: agentInfo,
                testResponse: null 
            }));
        } catch (error) {
            setState(prev => ({ 
                ...prev, 
                error: error instanceof Error ? error.message : 'Failed to load agent info'
            }));
        }
    };

    const handleDeleteAgent = async (treeId: string) => {
        if (!confirm('Are you sure you want to delete this agent?')) {
            return;
        }

        try {
            setState(prev => ({ ...prev, error: null }));
            await deleteAgent(treeId);
            
            // Clear current agent if it was deleted
            if (state.currentAgent?.treeId === treeId) {
                setState(prev => ({ ...prev, currentAgent: null, testResponse: null }));
            }
            
            setState(prev => ({ ...prev, success: 'Agent deleted successfully' }));
            await loadAgents();
        } catch (error) {
            setState(prev => ({ 
                ...prev, 
                error: error instanceof Error ? error.message : 'Failed to delete agent'
            }));
        }
    };

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
        setState(prev => ({ ...prev, success: 'Copied to clipboard!' }));
        setTimeout(() => setState(prev => ({ ...prev, success: null })), 2000);
    };

    return (
        <Box sx={{ p: 3, maxWidth: 1200, mx: 'auto' }}>
            <Typography variant="h4" gutterBottom align="center">
                A2A Agent Generator
            </Typography>
            <Typography variant="subtitle1" gutterBottom align="center" color="text.secondary">
                Create and test agents for your knowledge trees
            </Typography>

            {/* Error and Success Messages */}
            {state.error && (
                <Alert severity="error" sx={{ mb: 3 }} onClose={() => setState(prev => ({ ...prev, error: null }))}>
                    {state.error}
                </Alert>
            )}
            {state.success && (
                <Alert severity="success" sx={{ mb: 3 }} onClose={() => setState(prev => ({ ...prev, success: null }))}>
                    {state.success}
                </Alert>
            )}

            <Grid container spacing={3}>
                <Grid item xs={12} md={6}>
                    {/* Agent Creation Section */}
                    <Paper elevation={3} sx={{ p: 3, mb: 3 }}>
                        <Typography variant="h6" gutterBottom>
                            <Add sx={{ mr: 1, verticalAlign: 'middle' }} />
                            Create New Agent
                        </Typography>
                        
                        <TextField
                            fullWidth
                            label="Tree URL"
                            value={state.treeUrl}
                            onChange={(e) => setState(prev => ({ ...prev, treeUrl: e.target.value }))}
                            placeholder="https://treer.ai/?id=..."
                            sx={{ mb: 2 }}
                            error={state.treeUrl !== '' && !validateTreeUrl(state.treeUrl)}
                            helperText={state.treeUrl !== '' && !validateTreeUrl(state.treeUrl) ? 'Invalid tree URL' : ''}
                        />

                        <TextField
                            fullWidth
                            label="Paper Title"
                            value={state.paperTitle}
                            onChange={(e) => setState(prev => ({ ...prev, paperTitle: e.target.value }))}
                            placeholder="Enter a descriptive title for this agent"
                            sx={{ mb: 2 }}
                        />
                        <TextField
                            fullWidth
                            label="Icon URL (optional)"
                            value={state.iconUrl}
                            onChange={(e) => setState(prev => ({ ...prev, iconUrl: e.target.value }))}
                            placeholder="https://example.com/icon.png"
                            sx={{ mb: 3 }}
                            helperText="URL to an image that will be used as the agent's avatar in discussions"
                        />

                        <Button
                            variant="contained"
                            size="large"
                            startIcon={state.isCreating ? <CircularProgress size={20} /> : <Add />}
                            onClick={handleCreateAgent}
                            disabled={state.isCreating}
                            fullWidth
                        >
                            {state.isCreating ? 'Creating Agent...' : 'Create Agent'}
                        </Button>
                    </Paper>

                    {/* Agents List Section */}
                    <Paper elevation={3} sx={{ p: 3 }}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                            <Typography variant="h6">
                                Created Agents ({state.agents.length})
                            </Typography>
                            <IconButton onClick={loadAgents} disabled={state.isLoadingAgents}>
                                <Refresh />
                            </IconButton>
                        </Box>

                        {state.isLoadingAgents ? (
                            <Box sx={{ display: 'flex', justifyContent: 'center', p: 2 }}>
                                <CircularProgress />
                            </Box>
                        ) : state.agents.length === 0 ? (
                            <Typography color="text.secondary" align="center">
                                No agents created yet
                            </Typography>
                        ) : (
                            <List>
                                {state.agents.map((agent) => (
                                    <ListItem 
                                        key={agent.treeId}
                                        sx={{ 
                                            border: state.currentAgent?.treeId === agent.treeId ? '2px solid' : '1px solid',
                                            borderColor: state.currentAgent?.treeId === agent.treeId ? 'primary.main' : 'divider',
                                            borderRadius: 1, 
                                            mb: 1,
                                            cursor: 'pointer'
                                        }}
                                        onClick={() => handleSelectAgent(agent.treeId)}
                                    >
                                        <ListItemText
                                            primary={agent.paperTitle}
                                            secondary={`ID: ${agent.treeId.slice(0, 8)}...`}
                                        />
                                        <ListItemSecondaryAction>
                                            <IconButton
                                                edge="end"
                                                aria-label="delete"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleDeleteAgent(agent.treeId);
                                                }}
                                            >
                                                <Delete />
                                            </IconButton>
                                        </ListItemSecondaryAction>
                                    </ListItem>
                                ))}
                            </List>
                        )}
                    </Paper>
                </Grid>

                <Grid item xs={12} md={6}>
                    {/* Current Agent Info Section */}
                    {state.currentAgent && (
                        <Paper elevation={3} sx={{ p: 3, mb: 3 }}>
                            <Typography variant="h6" gutterBottom>
                                <SmartToy sx={{ mr: 1, verticalAlign: 'middle' }} />
                                Agent Information
                            </Typography>

                            <Box sx={{ mb: 2 }}>
                                <Typography variant="subtitle2" color="text.secondary">Agent URL:</Typography>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <Typography variant="body2" sx={{ wordBreak: 'break-all', flex: 1 }}>
                                        {state.currentAgent.agentUrl}
                                    </Typography>
                                    <Tooltip title="Copy URL">
                                        <IconButton 
                                            size="small" 
                                            onClick={() => copyToClipboard(state.currentAgent!.agentUrl)}
                                        >
                                            <ContentCopy fontSize="small" />
                                        </IconButton>
                                    </Tooltip>
                                </Box>
                            </Box>

                            <Box sx={{ mb: 2 }}>
                                <Typography variant="subtitle2" color="text.secondary">Title:</Typography>
                                <Typography variant="body2">{state.currentAgent.paperTitle}</Typography>
                            </Box>

                            <Box sx={{ mb: 2 }}>
                                <Typography variant="subtitle2" color="text.secondary">Status:</Typography>
                                <Chip 
                                    label={state.currentAgent.status} 
                                    color={state.currentAgent.status === 'active' ? 'success' : 'default'}
                                    size="small"
                                />
                            </Box>

                            {state.currentAgent.agentCard && (
                                <Accordion>
                                    <AccordionSummary expandIcon={<ExpandMore />}>
                                        <Typography variant="subtitle2">Agent Card Details</Typography>
                                    </AccordionSummary>
                                    <AccordionDetails>
                                        <Box sx={{ fontSize: '0.875rem' }}>
                                            <Typography variant="body2" gutterBottom>
                                                <strong>Name:</strong> {state.currentAgent.agentCard.name}
                                            </Typography>
                                            <Typography variant="body2" gutterBottom>
                                                <strong>Description:</strong> {state.currentAgent.agentCard.description}
                                            </Typography>
                                            {state.currentAgent.agentCard.skills && (
                                                <Box>
                                                    <Typography variant="body2" gutterBottom>
                                                        <strong>Skills:</strong>
                                                    </Typography>
                                                    {state.currentAgent.agentCard.skills.map((skill, index) => (
                                                        <Typography key={index} variant="caption" display="block">
                                                            • {skill.name}: {skill.description}
                                                        </Typography>
                                                    ))}
                                                </Box>
                                            )}
                                        </Box>
                                    </AccordionDetails>
                                </Accordion>
                            )}
                        </Paper>
                    )}

                    {/* Testing Section */}
                    {state.currentAgent && (
                        <Paper elevation={3} sx={{ p: 3 }}>
                            <Typography variant="h6" gutterBottom>
                                <Psychology sx={{ mr: 1, verticalAlign: 'middle' }} />
                                Test Agent
                            </Typography>

                            <TextField
                                fullWidth
                                label="Test Question"
                                value={state.testQuestion}
                                onChange={(e) => setState(prev => ({ ...prev, testQuestion: e.target.value }))}
                                placeholder="Ask a question to test the agent..."
                                multiline
                                rows={3}
                                sx={{ mb: 2 }}
                            />

                            <Button
                                variant="contained"
                                startIcon={state.isTesting ? <CircularProgress size={20} /> : <Send />}
                                onClick={handleTestAgent}
                                disabled={state.isTesting || !state.testQuestion.trim()}
                                fullWidth
                                sx={{ mb: 3 }}
                            >
                                {state.isTesting ? 'Testing...' : 'Send Question'}
                            </Button>

                            {state.testResponse && (
                                <Box>
                                    <Divider sx={{ mb: 2 }} />
                                    <Typography variant="subtitle2" gutterBottom>
                                        Response ({state.testResponse.durationMs}ms):
                                    </Typography>
                                    <Paper variant="outlined" sx={{ p: 2, bgcolor: 'grey.50' }}>
                                        <MessageContent 
                                            content={state.testResponse.response}
                                            agentName={state.testResponse.agentName}
                                        />
                                    </Paper>
                                    <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                                        Asked: "{state.testResponse.question}" at {new Date(state.testResponse.timestamp).toLocaleString()}
                                    </Typography>
                                </Box>
                            )}
                        </Paper>
                    )}

                    {!state.currentAgent && (
                        <Paper elevation={3} sx={{ p: 3, textAlign: 'center' }}>
                            <Typography color="text.secondary">
                                Select an agent from the list to view details and test functionality
                            </Typography>
                        </Paper>
                    )}
                </Grid>
            </Grid>
        </Box>
    );
};

export default AppAgentGenerator;