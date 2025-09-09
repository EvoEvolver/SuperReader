import React, { useState, useEffect } from 'react';
import {
    Box,
    Typography,
    Paper,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Button,
    IconButton,
    Chip,
    Alert,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogContentText,
    DialogTitle,
    Tooltip,
    Avatar
} from '@mui/material';
import {
    Delete as DeleteIcon,
    Refresh as RefreshIcon,
    ContentCopy as ContentCopyIcon,
    ManageAccounts as ManageAccountsIcon,
    SmartToy
} from '@mui/icons-material';
import { 
    listAgents, 
    deleteAgent, 
    AgentInfo 
} from './agent-api';

interface AgentManagementState {
    agents: AgentInfo[];
    isLoading: boolean;
    error: string | null;
    success: string | null;
    deleteDialog: {
        open: boolean;
        agent: AgentInfo | null;
        isDeleting: boolean;
    };
}

const AppAgentManagement: React.FC = () => {
    const [state, setState] = useState<AgentManagementState>({
        agents: [],
        isLoading: false,
        error: null,
        success: null,
        deleteDialog: {
            open: false,
            agent: null,
            isDeleting: false
        }
    });

    // Load agents on component mount
    useEffect(() => {
        loadAgents();
    }, []);

    const loadAgents = async () => {
        setState(prev => ({ ...prev, isLoading: true, error: null }));
        
        try {
            const agents = await listAgents();
            setState(prev => ({ 
                ...prev, 
                agents, 
                isLoading: false 
            }));
        } catch (error) {
            setState(prev => ({ 
                ...prev, 
                error: error instanceof Error ? error.message : 'Failed to load agents',
                isLoading: false 
            }));
        }
    };

    const handleDeleteClick = (agent: AgentInfo) => {
        setState(prev => ({
            ...prev,
            deleteDialog: {
                open: true,
                agent,
                isDeleting: false
            }
        }));
    };

    const handleDeleteConfirm = async () => {
        const { agent } = state.deleteDialog;
        if (!agent) return;

        setState(prev => ({
            ...prev,
            deleteDialog: {
                ...prev.deleteDialog,
                isDeleting: true
            }
        }));

        try {
            await deleteAgent(agent.treeId);
            
            setState(prev => ({
                ...prev,
                success: `Agent "${agent.paperTitle}" deleted successfully`,
                deleteDialog: {
                    open: false,
                    agent: null,
                    isDeleting: false
                }
            }));

            // Reload agents list
            await loadAgents();
            
        } catch (error) {
            setState(prev => ({
                ...prev,
                error: error instanceof Error ? error.message : 'Failed to delete agent',
                deleteDialog: {
                    ...prev.deleteDialog,
                    isDeleting: false
                }
            }));
        }
    };

    const handleDeleteCancel = () => {
        setState(prev => ({
            ...prev,
            deleteDialog: {
                open: false,
                agent: null,
                isDeleting: false
            }
        }));
    };

    const clearMessages = () => {
        setState(prev => ({ ...prev, error: null, success: null }));
    };

    const handleCopyUrl = async (agentUrl: string) => {
        try {
            await navigator.clipboard.writeText(agentUrl);
            setState(prev => ({ 
                ...prev, 
                success: 'Agent URL copied to clipboard!' 
            }));
            // Clear success message after 3 seconds
            setTimeout(() => {
                setState(prev => ({ ...prev, success: null }));
            }, 3000);
        } catch (error) {
            setState(prev => ({ 
                ...prev, 
                error: 'Failed to copy URL to clipboard' 
            }));
        }
    };

    const formatDate = (dateString: string) => {
        return new Date(dateString).toLocaleString();
    };

    const getStatusColor = (status: string) => {
        switch (status.toLowerCase()) {
            case 'active': return 'success';
            case 'initializing': return 'warning';
            case 'error': return 'error';
            default: return 'default';
        }
    };

    return (
        <Box sx={{ p: 3, maxWidth: 1400, mx: 'auto' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
                <ManageAccountsIcon sx={{ mr: 2, color: 'primary.main' }} />
                <Typography variant="h4" component="h1">
                    Agent Management
                </Typography>
                <Box sx={{ flexGrow: 1 }} />
                <Tooltip title="Refresh agents list">
                    <IconButton onClick={loadAgents} disabled={state.isLoading}>
                        <RefreshIcon />
                    </IconButton>
                </Tooltip>
            </Box>

            <Typography variant="subtitle1" gutterBottom color="text.secondary">
                Manage all active paper agents
            </Typography>

            {/* Error and Success Messages */}
            {state.error && (
                <Alert severity="error" sx={{ mb: 3 }} onClose={clearMessages}>
                    {state.error}
                </Alert>
            )}
            {state.success && (
                <Alert severity="success" sx={{ mb: 3 }} onClose={clearMessages}>
                    {state.success}
                </Alert>
            )}

            <Paper elevation={3}>
                {state.isLoading ? (
                    <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
                        <CircularProgress />
                    </Box>
                ) : state.agents.length === 0 ? (
                    <Box sx={{ textAlign: 'center', p: 4 }}>
                        <Typography variant="h6" color="text.secondary" gutterBottom>
                            No agents found
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                            Create your first agent using the Agent Generator
                        </Typography>
                    </Box>
                ) : (
                    <TableContainer>
                        <Table>
                            <TableHead>
                                <TableRow>
                                    <TableCell><strong>Agent URL / Title</strong></TableCell>
                                    <TableCell><strong>Status</strong></TableCell>
                                    <TableCell><strong>Created</strong></TableCell>
                                    <TableCell><strong>Last Active</strong></TableCell>
                                    <TableCell align="right"><strong>Actions</strong></TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {state.agents.map((agent) => (
                                    <TableRow key={agent.treeId} hover>
                                        <TableCell>
                                            <Box sx={{ maxWidth: 500 }}>
                                                <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                                                    {/* Agent Icon */}
                                                    {agent.iconUrl ? (
                                                        <Avatar 
                                                            src={agent.iconUrl} 
                                                            sx={{ width: 40, height: 40, flexShrink: 0 }}
                                                        />
                                                    ) : (
                                                        <Avatar sx={{ width: 40, height: 40, flexShrink: 0, bgcolor: 'primary.main' }}>
                                                            <SmartToy />
                                                        </Avatar>
                                                    )}
                                                    
                                                    {/* URL and Title */}
                                                    <Box sx={{ flex: 1, minWidth: 0 }}>
                                                        <Box
                                                            onClick={() => handleCopyUrl(agent.agentUrl)}
                                                            sx={{ 
                                                                display: 'flex', 
                                                                alignItems: 'center',
                                                                cursor: 'pointer',
                                                                p: 1,
                                                                borderRadius: 1,
                                                                '&:hover': { 
                                                                    backgroundColor: 'action.hover' 
                                                                }
                                                            }}
                                                        >
                                                    <Typography
                                                        variant="body2"
                                                        sx={{
                                                            fontFamily: 'monospace',
                                                            fontSize: '0.875rem',
                                                            color: 'primary.main',
                                                            wordBreak: 'break-all',
                                                            flex: 1
                                                        }}
                                                    >
                                                        {agent.agentUrl}
                                                    </Typography>
                                                    <Tooltip title="Click to copy URL">
                                                        <ContentCopyIcon sx={{ ml: 1, fontSize: 16, color: 'action.active' }} />
                                                    </Tooltip>
                                                </Box>
                                                        <Typography
                                                            variant="subtitle2"
                                                            sx={{ mt: 0.5, fontWeight: 'medium', pl: 1 }}
                                                        >
                                                            {agent.paperTitle}
                                                        </Typography>
                                                    </Box>
                                                </Box>
                                            </Box>
                                        </TableCell>
                                        <TableCell>
                                            <Chip
                                                label={agent.status}
                                                color={getStatusColor(agent.status)}
                                                size="small"
                                                variant="outlined"
                                            />
                                        </TableCell>
                                        <TableCell>
                                            <Typography variant="body2">
                                                {formatDate(agent.createdAt)}
                                            </Typography>
                                        </TableCell>
                                        <TableCell>
                                            <Typography variant="body2">
                                                {formatDate(agent.lastActive)}
                                            </Typography>
                                        </TableCell>
                                        <TableCell align="right">
                                            <Tooltip title="Delete agent">
                                                <IconButton
                                                    color="error"
                                                    onClick={() => handleDeleteClick(agent)}
                                                    size="small"
                                                >
                                                    <DeleteIcon />
                                                </IconButton>
                                            </Tooltip>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </TableContainer>
                )}
            </Paper>

            {/* Delete Confirmation Dialog */}
            <Dialog
                open={state.deleteDialog.open}
                onClose={handleDeleteCancel}
                maxWidth="sm"
                fullWidth
            >
                <DialogTitle>Delete Agent</DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        Are you sure you want to delete the agent for "{state.deleteDialog.agent?.paperTitle}"?
                    </DialogContentText>
                    <DialogContentText sx={{ mt: 1, color: 'text.secondary', fontSize: '0.875rem' }}>
                        This action cannot be undone. The agent will no longer be accessible.
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button onClick={handleDeleteCancel} disabled={state.deleteDialog.isDeleting}>
                        Cancel
                    </Button>
                    <Button
                        onClick={handleDeleteConfirm}
                        color="error"
                        variant="contained"
                        disabled={state.deleteDialog.isDeleting}
                        startIcon={state.deleteDialog.isDeleting ? <CircularProgress size={16} /> : <DeleteIcon />}
                    >
                        {state.deleteDialog.isDeleting ? 'Deleting...' : 'Delete'}
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};

export default AppAgentManagement;