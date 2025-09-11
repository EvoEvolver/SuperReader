import OpenAI from 'openai';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import FormData from 'form-data';
// import sharp from 'sharp'; // Commented out due to installation issues
import { v4 as uuidv4 } from 'uuid';
import { promisify } from 'util';
import { pipeline } from 'stream';
import { minioClient } from './minio_upload';
import { ChatOpenAI } from '@langchain/openai';
import { PromptTemplate } from '@langchain/core/prompts';
import { config, getChatModelConfig } from './config';
import {
    ImageEditRequest,
    ImageEditResponse,
    ImageEditConfig,
    OpenAIImageEditResult,
    ProcessingMetadata,
    ImageEditError,
    ImageEditErrorType
} from './types/imageEdit';

const streamPipeline = promisify(pipeline);

/**
 * ImageEditService - AI-powered image editing using OpenAI's gpt-image-1 model
 * with automatic MinIO storage integration
 */
export class ImageEditService {
    private openai: OpenAI;
    private chatModel: ChatOpenAI;
    private config: ImageEditConfig;
    private activeOperations: Map<string, ProcessingMetadata> = new Map();

    constructor(configOverrides: Partial<ImageEditConfig> = {}) {
        this.config = {
            apiKey: config.openai.apiKey,
            referenceImageUrl: config.imageEdit.referenceImageUrl,
            minioBucket: config.imageEdit.minioBucket,
            tempDir: path.join(__dirname, '../temp'),
            maxFileSize: config.imageEdit.maxFileSize,
            ...configOverrides
        };

        if (!this.config.apiKey) {
            throw new Error('OPENAI_API_KEY is required for ImageEditService');
        }

        this.openai = new OpenAI({
            apiKey: this.config.apiKey,
        });

        // Initialize ChatGPT model for prompt summarization
        this.chatModel = new ChatOpenAI(getChatModelConfig());

        this.ensureTempDir();
    }

    /**
     * Edit an image using OpenAI's gpt-image-1 model
     */
    async editImage(request: ImageEditRequest): Promise<ImageEditResponse> {
        const startTime = Date.now();
        const operationId = uuidv4();
        
        console.log(`[ImageEditService] Starting image edit operation ${operationId} with prompt: "${request.prompt}"`);

        try {
            // Validate request
            this.validateRequest(request);

            // Handle prompt summarization if needed
            let actualPrompt = request.prompt;
            if (request.prompt.length > 1000) {
                console.log(`[ImageEditService] Original prompt too long (${request.prompt.length} chars), summarizing...`);
                actualPrompt = await this.summarizePrompt(request.prompt);
                console.log(`[ImageEditService] Using summarized prompt: "${actualPrompt}"`);
            }

            // Initialize processing metadata
            const metadata: ProcessingMetadata = {
                operationId,
                prompt: actualPrompt,
                hasMask: !!request.mask,
                startTime: new Date(),
                tempPaths: []
            };
            this.activeOperations.set(operationId, metadata);

            // Download reference image
            const referenceImagePath = await this.downloadReferenceImage(operationId);
            metadata.tempPaths.push(referenceImagePath);

            // Prepare mask if provided
            let maskPath: string | undefined;
            if (request.mask) {
                maskPath = await this.saveMaskFile(request.mask, operationId);
                metadata.tempPaths.push(maskPath);
            }

            // Edit image with OpenAI
            const editResult = await this.editImageWithOpenAI(
                referenceImagePath,
                actualPrompt,
                maskPath
            );

            // Save base64 image data to file (gpt-image-1 returns base64, not URL)
            const editedImagePath = await this.saveBase64Image(editResult.url, operationId);
            metadata.tempPaths.push(editedImagePath);

            // Upload to MinIO
            const { publicUrl, minioPath } = await this.uploadToMinIO(editedImagePath, operationId);

            // Clean up
            await this.cleanup(operationId);

            const durationMs = Date.now() - startTime;
            console.log(`[ImageEditService] Image edit operation ${operationId} completed in ${durationMs}ms`);

            return {
                success: true,
                imageUrl: publicUrl,
                minioPath,
                durationMs,
                operationId
            };

        } catch (error) {
            console.error(`[ImageEditService] Error in operation ${operationId}:`, error);
            
            // Clean up on error
            await this.cleanup(operationId);

            const durationMs = Date.now() - startTime;
            
            return {
                success: false,
                error: error instanceof ImageEditError ? error.message : 'Unknown error occurred',
                durationMs,
                operationId
            };
        }
    }

    /**
     * Summarize a long prompt using ChatGPT to fit within limits
     */
    private async summarizePrompt(originalPrompt: string): Promise<string> {
        try {
            console.log(`[ImageEditService] Summarizing long prompt (${originalPrompt.length} chars)`);
            
            const promptTemplate = PromptTemplate.fromTemplate(`
Below is information for a paper, I want to generate a cartoon icon for this paper, please give me a prompt no more than 50 words for input to diffusion model.

Original content:
{originalPrompt}

Instructions:
- Focus on key visual elements that would make a good cartoon icon
- Keep it under 50 words
- Make it suitable for diffusion model image generation
- Focus on style, colors, and main subjects rather than text content

Summarized prompt:`);

            // @ts-ignore
            const chain = promptTemplate.pipe(this.chatModel);
            
            const response = await chain.invoke({
                originalPrompt: originalPrompt
            });
            
            const summarizedPrompt = typeof response.content === 'string' 
                ? response.content.trim() 
                : JSON.stringify(response.content);
            
            console.log(`[ImageEditService] Prompt summarized: "${summarizedPrompt}" (${summarizedPrompt.length} chars)`);
            
            // Ensure the summarized prompt is not empty and is reasonable
            if (!summarizedPrompt || summarizedPrompt.length < 10) {
                throw new Error('Summarized prompt is too short or empty');
            }
            
            // If still too long, truncate to first 50 words
            const words = summarizedPrompt.split(/\s+/);
            if (words.length > 50) {
                const truncated = words.slice(0, 50).join(' ');
                console.log(`[ImageEditService] Truncated to 50 words: "${truncated}"`);
                return truncated;
            }
            
            return summarizedPrompt;
            
        } catch (error) {
            console.error('[ImageEditService] Error summarizing prompt:', error);
            
            // Fallback: create a simple truncated version
            const fallbackPrompt = "Create a colorful cartoon-style icon based on the provided content";
            console.log(`[ImageEditService] Using fallback prompt: "${fallbackPrompt}"`);
            return fallbackPrompt;
        }
    }

    /**
     * Validate the image edit request
     */
    private validateRequest(request: ImageEditRequest): void {
        if (!request.prompt || request.prompt.trim().length === 0) {
            throw new ImageEditError(
                ImageEditErrorType.INVALID_PROMPT,
                'Prompt is required and cannot be empty'
            );
        }

        // Note: Long prompts are now handled by automatic summarization in editImage()

        if (request.mask) {
            // Validate mask file
            if (!request.mask.mimetype.startsWith('image/')) {
                throw new ImageEditError(
                    ImageEditErrorType.INVALID_MASK_FORMAT,
                    'Mask must be an image file'
                );
            }

            if (request.mask.size > this.config.maxFileSize) {
                throw new ImageEditError(
                    ImageEditErrorType.FILE_SIZE_EXCEEDED,
                    `Mask file size (${request.mask.size}) exceeds maximum allowed size (${this.config.maxFileSize})`
                );
            }
        }
    }

    /**
     * Download the reference image to local temporary file
     */
    private async downloadReferenceImage(operationId: string): Promise<string> {
        try {
            const response = await axios({
                method: 'GET',
                url: this.config.referenceImageUrl,
                responseType: 'stream',
                timeout: 30000 // 30 seconds timeout
            });

            const referenceImagePath = path.join(
                this.config.tempDir, 
                `reference_${operationId}.jpg`
            );

            await streamPipeline(response.data, fs.createWriteStream(referenceImagePath));
            
            console.log(`[ImageEditService] Reference image downloaded to: ${referenceImagePath}`);
            return referenceImagePath;

        } catch (error) {
            throw new ImageEditError(
                ImageEditErrorType.REFERENCE_DOWNLOAD_FAILED,
                `Failed to download reference image: ${error instanceof Error ? error.message : 'Unknown error'}`,
                error
            );
        }
    }

    /**
     * Save the mask file to temporary location
     */
    private async saveMaskFile(maskFile: Express.Multer.File, operationId: string): Promise<string> {
        try {
            const maskPath = path.join(
                this.config.tempDir,
                `mask_${operationId}.png`
            );

            await fs.promises.writeFile(maskPath, maskFile.buffer);
            console.log(`[ImageEditService] Mask file saved to: ${maskPath}`);
            return maskPath;

        } catch (error) {
            throw new ImageEditError(
                ImageEditErrorType.FILE_PROCESSING_ERROR,
                `Failed to save mask file: ${error instanceof Error ? error.message : 'Unknown error'}`,
                error
            );
        }
    }

    /**
     * Edit image using OpenAI's gpt-image-1 model
     */
    private async editImageWithOpenAI(
        imagePath: string, 
        prompt: string, 
        maskPath?: string
    ): Promise<OpenAIImageEditResult> {
        try {
            console.log(`[ImageEditService] Calling OpenAI image edit API with model: ${config.openai.imageModel}`);

            // Read image file and create proper File object with correct MIME type
            const imageBuffer = await fs.promises.readFile(imagePath);
            const imageExtension = path.extname(imagePath).toLowerCase();
            
            // Determine MIME type based on file extension
            let mimeType = 'image/jpeg';
            if (imageExtension === '.png') {
                mimeType = 'image/png';
            } else if (imageExtension === '.webp') {
                mimeType = 'image/webp';
            }

            // Create File object with proper MIME type (using form-data for Node.js compatibility)
            const imageFile = new File([imageBuffer], path.basename(imagePath), {
                type: mimeType
            });

            const editParams: any = {
                image: imageFile,
                prompt: prompt,
                model: config.openai.imageModel,
                size: "1024x1024", // gpt-image-1 supports: 1024x1024, 1024x1536, 1536x1024
                quality: "medium", // low, medium, high (fixed as per user requirement)
                n: 1
            };

            // Add mask if provided
            if (maskPath) {
                const maskBuffer = await fs.promises.readFile(maskPath);
                const maskFile = new File([maskBuffer], path.basename(maskPath), {
                    type: 'image/png' // Masks are typically PNG
                });
                editParams.mask = maskFile;
            }

            const response = await this.openai.images.edit(editParams);

            if (!response.data || response.data.length === 0) {
                throw new Error('No image data returned from OpenAI');
            }

            const result = response.data[0];
            // gpt-image-1 returns base64-encoded images instead of URLs
            if (!result.b64_json) {
                throw new Error('No base64 image data returned from OpenAI');
            }

            console.log(`[ImageEditService] OpenAI image edit successful, received base64 data`);
            
            return {
                url: result.b64_json, // Store base64 data in url field for compatibility
                revisedPrompt: result.revised_prompt
            };

        } catch (error) {
            // Handle specific gpt-image-1 errors
            let errorMessage = error instanceof Error ? error.message : 'Unknown error';
            let errorType = ImageEditErrorType.OPENAI_API_ERROR;
            
            // Check for organization verification requirement
            if (errorMessage.includes('organization') && errorMessage.includes('verification')) {
                errorType = ImageEditErrorType.OPENAI_API_ERROR;
                errorMessage = 'Organization verification required for gpt-image-1. Please verify your organization at https://platform.openai.com/organization';
            }
            
            // Check for access denied or permission errors
            if (errorMessage.includes('access') || errorMessage.includes('permission') || errorMessage.includes('unauthorized')) {
                errorMessage = `Access denied for gpt-image-1: ${errorMessage}. This model requires organization verification.`;
            }
            
            throw new ImageEditError(
                errorType,
                `OpenAI API error: ${errorMessage}`,
                error
            );
        }
    }

    /**
     * Save base64 image data to file (for gpt-image-1 responses)
     */
    private async saveBase64Image(base64Data: string, operationId: string): Promise<string> {
        try {
            // Remove data URL prefix if present (data:image/png;base64,...)
            const cleanBase64 = base64Data.replace(/^data:image\/[a-z]+;base64,/, '');
            
            const editedImagePath = path.join(
                this.config.tempDir,
                `edited_${operationId}.png`
            );

            // Convert base64 to buffer and save to file
            const imageBuffer = Buffer.from(cleanBase64, 'base64');
            await fs.promises.writeFile(editedImagePath, imageBuffer);
            
            console.log(`[ImageEditService] Base64 image saved to: ${editedImagePath}`);
            return editedImagePath;

        } catch (error) {
            throw new ImageEditError(
                ImageEditErrorType.FILE_PROCESSING_ERROR,
                `Failed to save base64 image: ${error instanceof Error ? error.message : 'Unknown error'}`,
                error
            );
        }
    }

    /**
     * Convert image to PNG format to ensure OpenAI compatibility
     * TODO: Re-implement when Sharp installation is fixed
     */
    private async convertImageToPNG(imagePath: string): Promise<string> {
        // For now, just return the original path
        // OpenAI should handle JPEG format according to their docs
        console.log(`[ImageEditService] Using image directly without conversion: ${imagePath}`);
        return imagePath;
    }

    /**
     * Upload the edited image to MinIO bucket
     */
    private async uploadToMinIO(imagePath: string, operationId: string): Promise<{ publicUrl: string; minioPath: string }> {
        try {
            // Generate unique filename
            const timestamp = Date.now();
            const filename = `edited_${operationId}_${timestamp}.png`;
            
            // Ensure bucket exists
            const bucketExists = await minioClient.bucketExists(this.config.minioBucket);
            if (!bucketExists) {
                await minioClient.makeBucket(this.config.minioBucket);
                console.log(`[ImageEditService] Created MinIO bucket: ${this.config.minioBucket}`);
            }

            // Upload file
            await minioClient.fPutObject(
                this.config.minioBucket,
                filename,
                imagePath,
                {
                    'Content-Type': 'image/png',
                    'Cache-Control': 'public, max-age=31536000' // 1 year cache
                }
            );

            const publicUrl = `${process.env.MINIO_PUBLIC_HOST}/${this.config.minioBucket}/${filename}`;
            const minioPath = `${this.config.minioBucket}/${filename}`;

            console.log(`[ImageEditService] Image uploaded to MinIO: ${publicUrl}`);
            
            return { publicUrl, minioPath };

        } catch (error) {
            throw new ImageEditError(
                ImageEditErrorType.MINIO_UPLOAD_FAILED,
                `Failed to upload to MinIO: ${error instanceof Error ? error.message : 'Unknown error'}`,
                error
            );
        }
    }

    /**
     * Clean up temporary files for an operation
     */
    private async cleanup(operationId: string): Promise<void> {
        const metadata = this.activeOperations.get(operationId);
        if (!metadata) return;

        try {
            // Remove all temporary files
            for (const tempPath of metadata.tempPaths) {
                try {
                    if (fs.existsSync(tempPath)) {
                        await fs.promises.unlink(tempPath);
                        console.log(`[ImageEditService] Cleaned up temp file: ${tempPath}`);
                    }
                } catch (error) {
                    console.warn(`[ImageEditService] Failed to clean up temp file ${tempPath}:`, error);
                }
            }

            // Remove from active operations
            this.activeOperations.delete(operationId);
            
        } catch (error) {
            console.error(`[ImageEditService] Error during cleanup for operation ${operationId}:`, error);
        }
    }

    /**
     * Ensure temporary directory exists
     */
    private ensureTempDir(): void {
        if (!fs.existsSync(this.config.tempDir)) {
            fs.mkdirSync(this.config.tempDir, { recursive: true });
            console.log(`[ImageEditService] Created temp directory: ${this.config.tempDir}`);
        }
    }

    /**
     * Get service health status
     */
    async getHealthStatus(): Promise<{ healthy: boolean; activeOperations: number; error?: string }> {
        try {
            // Simple health check - verify OpenAI API key and MinIO connection
            const bucketExists = await minioClient.bucketExists(this.config.minioBucket);
            
            return {
                healthy: true,
                activeOperations: this.activeOperations.size
            };
        } catch (error) {
            return {
                healthy: false,
                activeOperations: this.activeOperations.size,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }

    /**
     * Clean up all active operations (for graceful shutdown)
     */
    async shutdown(): Promise<void> {
        console.log(`[ImageEditService] Shutting down, cleaning up ${this.activeOperations.size} active operations`);
        
        const cleanupPromises = Array.from(this.activeOperations.keys()).map(operationId => 
            this.cleanup(operationId)
        );
        
        await Promise.all(cleanupPromises);
        console.log('[ImageEditService] Shutdown complete');
    }
}