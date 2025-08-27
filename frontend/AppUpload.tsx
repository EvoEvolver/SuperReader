// src/components/DocumentUpload.tsx
import React, { useState } from 'react';
import {
    Box,
    Button,
    Typography,
    CircularProgress,
    Alert,
    Paper,
    Chip
} from '@mui/material';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import {worker_endpoint} from "./config";

// Supported file types and their configurations
const SUPPORTED_FORMATS = {
    'application/pdf': { extension: '.pdf', name: 'PDF', endpoint: 'upload_pdf', submitEndpoint: 'submit/pdf_to_tree' },
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { extension: '.docx', name: 'DOCX', endpoint: 'upload_document', submitEndpoint: 'submit/document_to_tree' },
    'application/msword': { extension: '.doc', name: 'DOC', endpoint: 'upload_document', submitEndpoint: 'submit/document_to_tree' },
    'text/markdown': { extension: '.md', name: 'Markdown', endpoint: 'upload_document', submitEndpoint: 'submit/document_to_tree' },
    'text/plain': { extension: '.txt', name: 'Text', endpoint: 'upload_document', submitEndpoint: 'submit/document_to_tree' }
};

// Extension-based mapping for fallback detection
const EXTENSION_TO_FORMAT = {
    '.pdf': 'application/pdf',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.doc': 'application/msword',
    '.md': 'text/markdown',
    '.markdown': 'text/markdown',
    '.txt': 'text/plain'
};

// Helper function to get file format by MIME type or extension
function getFileFormat(file: File) {
    // First try by MIME type
    if (file.type && SUPPORTED_FORMATS[file.type as keyof typeof SUPPORTED_FORMATS]) {
        return { format: SUPPORTED_FORMATS[file.type as keyof typeof SUPPORTED_FORMATS], mimeType: file.type };
    }
    
    // Fallback to extension-based detection
    const fileName = file.name.toLowerCase();
    for (const [ext, mimeType] of Object.entries(EXTENSION_TO_FORMAT)) {
        if (fileName.endsWith(ext)) {
            return { 
                format: SUPPORTED_FORMATS[mimeType as keyof typeof SUPPORTED_FORMATS], 
                mimeType: mimeType 
            };
        }
    }
    
    return null;
}

const DocumentUpload: React.FC = () => {
    const [file, setFile] = useState<File | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);
    const [fileType, setFileType] = useState<string | null>(null);

    const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFile = event.target.files?.[0];
        if (selectedFile) {
            console.log('Selected file:', selectedFile.name, 'MIME type:', selectedFile.type);
            
            const fileFormatResult = getFileFormat(selectedFile);
            
            if (fileFormatResult) {
                setFile(selectedFile);
                setFileType(fileFormatResult.mimeType);
                setError(null);
                console.log('File accepted:', fileFormatResult.format.name);
            } else {
                const supportedExtensions = Object.values(SUPPORTED_FORMATS).map(f => f.extension).join(', ');
                setError(`Please upload supported file types: ${supportedExtensions}`);
                setFile(null);
                setFileType(null);
                console.log('File rejected - not in supported formats');
            }
        }
    };

    const handleUpload = async () => {
        if (!file || !fileType) return;

        setLoading(true);
        setError(null);
        setSuccess(false);

        const fileFormat = SUPPORTED_FORMATS[fileType as keyof typeof SUPPORTED_FORMATS];
        const formData = new FormData();
        formData.append('file', file);

        try {
            // Upload file to appropriate endpoint
            const uploadResponse = await fetch(`${worker_endpoint}/${fileFormat.endpoint}`, {
                method: 'POST',
                body: formData,
            });

            console.log(uploadResponse);

            if (!uploadResponse.ok) {
                throw new Error('Upload failed');
            }

            const uploadData = await uploadResponse.json();
            const fileUrl = uploadData["url"];
            const originalFilename = file.name;
            
            console.log('File uploaded to:', fileUrl);
            
            // Send file to appropriate tree processing endpoint
            const job_id = await sendToTreeRequest(fileUrl, fileFormat, originalFilename);
            
            // Open new tab with waiting page
            const waitingUrl = getWaitingPageUrl(job_id);
            window.open(waitingUrl, '_self');

            setSuccess(true);
            setFile(null);
            setFileType(null);
        } catch (err) {
            console.error('Upload error:', err);
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
                    Upload Document
                </Typography>

                <Box sx={{ mb: 2, display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                    {Object.values(SUPPORTED_FORMATS).map((format) => (
                        <Chip 
                            key={format.extension}
                            label={format.name}
                            size="small"
                            variant="outlined"
                        />
                    ))}
                </Box>

                <Button
                    component="label"
                    variant="outlined"
                    startIcon={<CloudUploadIcon />}
                    sx={{ mt: 2, mb: 2 }}
                >
                    Choose Document
                    <input
                        type="file"
                        accept={Object.values(SUPPORTED_FORMATS).map(f => f.extension).join(',')}
                        hidden
                        onChange={handleFileChange}
                    />
                </Button>

                {file && fileType && (
                    <Box sx={{ mb: 2, textAlign: 'center' }}>
                        <Typography variant="body2">
                            Selected file: {file.name}
                        </Typography>
                        <Chip 
                            label={SUPPORTED_FORMATS[fileType as keyof typeof SUPPORTED_FORMATS].name}
                            color="primary"
                            size="small"
                            sx={{ mt: 1 }}
                        />
                    </Box>
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
                        Document uploaded successfully!
                    </Alert>
                )}
            </Paper>
        </Box>
    );
};

async function sendToTreeRequest(fileUrl: string, fileFormat: any, originalFilename: string) {
    const requestBody: any = {
        file_url: fileUrl
    };

    // Add additional parameters for document processing
    if (fileFormat.submitEndpoint === 'submit/document_to_tree') {
        requestBody.file_type = 'document';
        requestBody.original_filename = originalFilename;
    }

    const response = await fetch(`${worker_endpoint}/${fileFormat.submitEndpoint}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
    }).then(response => response.json());
    
    return response["job_id"];
}

function getWaitingPageUrl(job_id: string) {
    return `${worker_endpoint}/wait?job_id=${encodeURIComponent(job_id)}`;
}

export default DocumentUpload;