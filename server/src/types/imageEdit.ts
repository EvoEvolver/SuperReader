import { Express } from 'express';

/**
 * Request interface for image editing API
 */
export interface ImageEditRequest {
    /** Text prompt describing the desired image modifications */
    prompt: string;
    /** Optional mask file for targeted editing (PNG format) */
    mask?: Express.Multer.File;
}

/**
 * Response interface for image editing API
 */
export interface ImageEditResponse {
    /** Whether the operation was successful */
    success: boolean;
    /** Public URL of the edited image (if successful) */
    imageUrl?: string;
    /** MinIO path/key of the uploaded image (if successful) */
    minioPath?: string;
    /** Error message (if unsuccessful) */
    error?: string;
    /** Processing duration in milliseconds */
    durationMs?: number;
    /** Unique operation ID for tracking */
    operationId?: string;
}

/**
 * Configuration options for image editing service
 */
export interface ImageEditConfig {
    /** OpenAI API key */
    apiKey: string;
    /** Default reference image URL */
    referenceImageUrl: string;
    /** MinIO bucket name for storing edited images */
    minioBucket: string;
    /** Temporary directory for file processing */
    tempDir: string;
    /** Maximum file size for uploads (in bytes) */
    maxFileSize: number;
}

/**
 * Internal processing result from OpenAI API
 */
export interface OpenAIImageEditResult {
    /** Generated image URL from OpenAI */
    url: string;
    /** Optional revised prompt from OpenAI */
    revisedPrompt?: string;
}

/**
 * File processing metadata
 */
export interface ProcessingMetadata {
    /** Unique operation identifier */
    operationId: string;
    /** Original prompt */
    prompt: string;
    /** Whether a mask was provided */
    hasMask: boolean;
    /** Processing start timestamp */
    startTime: Date;
    /** Temporary file paths for cleanup */
    tempPaths: string[];
}

/**
 * Error types for image editing operations
 */
export enum ImageEditErrorType {
    INVALID_PROMPT = 'INVALID_PROMPT',
    REFERENCE_DOWNLOAD_FAILED = 'REFERENCE_DOWNLOAD_FAILED',
    OPENAI_API_ERROR = 'OPENAI_API_ERROR',
    MINIO_UPLOAD_FAILED = 'MINIO_UPLOAD_FAILED',
    FILE_PROCESSING_ERROR = 'FILE_PROCESSING_ERROR',
    INVALID_MASK_FORMAT = 'INVALID_MASK_FORMAT',
    FILE_SIZE_EXCEEDED = 'FILE_SIZE_EXCEEDED'
}

/**
 * Custom error class for image editing operations
 */
export class ImageEditError extends Error {
    constructor(
        public type: ImageEditErrorType,
        message: string,
        public details?: any
    ) {
        super(message);
        this.name = 'ImageEditError';
    }
}