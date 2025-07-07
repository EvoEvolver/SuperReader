import React, {useEffect, useState} from 'react';
import {Alert, Box, Button, CircularProgress, Container, Paper, Typography} from '@mui/material';
import {styled} from '@mui/system';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import {JobStatus, wait_for_result, WaitResponse} from "./requests";


const StyledPaper = styled(Paper)(({theme}) => ({
    padding: theme.spacing(4),
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: theme.spacing(3),
    maxWidth: 600,
    margin: '2rem auto'
}));

export function AppWait() {
    const [waitResponse, setWaitResponse] = useState<WaitResponse>({
        treeUrl: null,
        status: JobStatus.PROCESSING,
    });

    const params = new URLSearchParams(window.location.search);
    const job_id = params.get('job_id');

    useEffect(() => {
        if (!job_id) {
            setWaitResponse({treeUrl: null, status: JobStatus.ERROR, message: 'No job id provided'});
            return;
        }

        const updateWaitResponse = (response: WaitResponse) => {
            console.log(response)
            if (response.status === JobStatus.COMPLETE && response.treeUrl) {
                window.open(response.treeUrl, '_self');
            }
            setWaitResponse(response);
        };

        wait_for_result(job_id, updateWaitResponse);
    }, [job_id]);

    return (
        <Container maxWidth="sm">
            <StyledPaper elevation={3}>
                <Typography variant="h4" component="h1" gutterBottom>
                    Job Status
                </Typography>

                {waitResponse.status === JobStatus.PROCESSING && (
                    <Box sx={{textAlign: 'center'}}>
                        <CircularProgress size={48} sx={{mb: 2}}/>
                        <Typography variant="body1" color="text.secondary">
                            Processing your request... The result will appear automatically when ready.
                        </Typography>
                        <Typography>
                            {waitResponse.message || ""}
                        </Typography>
                    </Box>
                )}

                {waitResponse.treeUrl && (
                    <Box sx={{textAlign: 'center', width: '100%'}}>
                        <CheckCircleOutlineIcon
                            color="success"
                            sx={{fontSize: 48, mb: 2}}
                        />
                        <Typography variant="h6" gutterBottom>
                            Process completed successfully!
                        </Typography>
                        <Button
                            variant="contained"
                            color="primary"
                            href={waitResponse.treeUrl}
                            sx={{mt: 2}}
                        >
                            View Result
                        </Button>
                    </Box>
                )}

                {waitResponse.status === JobStatus.ERROR && (
                    <Alert
                        severity="error"
                        sx={{width: '100%'}}
                    >
                        {waitResponse.message || "Error occurred"}
                    </Alert>
                )}

                {waitResponse.status === JobStatus.FAILED && (
                    <Alert
                        severity="error"
                        sx={{width: '100%'}}
                    >
                        {waitResponse.message || "The processing is failed"}
                    </Alert>
                )}
            </StyledPaper>
        </Container>
    );
}