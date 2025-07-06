// src/components/PdfUpload.tsx
import React, { useState } from 'react';
import {
    Box,
    Button,
    Typography,
    CircularProgress,
    Alert,
    Paper
} from '@mui/material';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';

const worker_endpoint = "https://worker.treer.ai"

const PdfUpload: React.FC = () => {
    const [file, setFile] = useState<File | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFile = event.target.files?.[0];
        if (selectedFile) {
            if (selectedFile.type === 'application/pdf') {
                setFile(selectedFile);
                setError(null);
            } else {
                setError('Please upload only PDF files');
                setFile(null);
            }
        }
    };

    const handleUpload = async () => {
        if (!file) return;

        setLoading(true);
        setError(null);
        setSuccess(false);

        const formData = new FormData();
        formData.append('file', file);

        try {
            const response = await fetch(worker_endpoint+'/upload_pdf', {
                method: 'POST',
                body: formData,
            });

            console.log(response)

            if (!response.ok) {
                throw new Error('Upload failed')
            }

            const responseData = await response.json()
            const fileUrl = responseData["url"]
            console.log(fileUrl)
            // Send PDF to tree processing
            const job_id = await sendPdfToTreeRequest(fileUrl)
            
            // Open new tab with waiting page
            const waitingUrl = getWaitingPageUrl(job_id)
            window.open(waitingUrl, '_self')

            setSuccess(true);
            setFile(null);
        } catch (err) {
            setError('Failed to upload file. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <Box
            sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                p: 3,
            }}
        >
            <Paper
                elevation={3}
                sx={{
                    p: 4,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    maxWidth: 400,
                    width: '100%',
                }}
            >
                <Typography variant="h5" gutterBottom>
                    Upload PDF File
                </Typography>

                <Button
                    component="label"
                    variant="outlined"
                    startIcon={<CloudUploadIcon />}
                    sx={{ mt: 2, mb: 2 }}
                >
                    Choose PDF File
                    <input
                        type="file"
                        accept=".pdf"
                        hidden
                        onChange={handleFileChange}
                    />
                </Button>

                {file && (
                    <Typography variant="body2" sx={{ mb: 2 }}>
                        Selected file: {file.name}
                    </Typography>
                )}

                <Button
                    variant="contained"
                    onClick={handleUpload}
                    disabled={!file || loading}
                    sx={{ mt: 2 }}
                >
                    {loading ? <CircularProgress size={24} /> : 'Upload'}
                </Button>

                {error && (
                    <Alert severity="error" sx={{ mt: 2, width: '100%' }}>
                        {error}
                    </Alert>
                )}

                {success && (
                    <Alert severity="success" sx={{ mt: 2, width: '100%' }}>
                        File uploaded successfully!
                    </Alert>
                )}
            </Paper>
        </Box>
    );
};

async function sendPdfToTreeRequest(pdf_url) {
    const response = await fetch(worker_endpoint + '/submit/pdf_to_tree', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            file_url: pdf_url
        })
    }).then(response => response.json())
    return response["job_id"]
}

function getWaitingPageUrl(job_id) {
    return `${worker_endpoint}/wait?job_id=${encodeURIComponent(job_id)}`
}

export default PdfUpload;