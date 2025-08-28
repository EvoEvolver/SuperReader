import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as crypto from 'crypto';
import { uploadFileToMinio } from './minio_upload';
import { JobStatus, setJobProgress } from './jobStatus';

const execAsync = promisify(exec);

export interface DocumentFormat {
    extension: string;
    mimeType: string;
    pandocFormat: string;
}

export const SUPPORTED_FORMATS: Record<string, DocumentFormat> = {
    docx: {
        extension: '.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        pandocFormat: 'docx'
    },
    doc: {
        extension: '.doc',
        mimeType: 'application/msword',
        pandocFormat: 'doc'
    },
    md: {
        extension: '.md',
        mimeType: 'text/markdown',
        pandocFormat: 'markdown'
    },
    markdown: {
        extension: '.markdown',
        mimeType: 'text/markdown',
        pandocFormat: 'markdown'
    },
    txt: {
        extension: '.txt',
        mimeType: 'text/plain',
        pandocFormat: 'plain'
    }
};

/**
 * Detect document format based on file extension and MIME type
 */
export function detectDocumentFormat(filename: string, mimeType: string): DocumentFormat | null {
    const extension = path.extname(filename).toLowerCase();
    
    // First try to match by extension
    for (const [key, format] of Object.entries(SUPPORTED_FORMATS)) {
        if (format.extension === extension) {
            return format;
        }
    }
    
    // Then try to match by MIME type
    for (const [key, format] of Object.entries(SUPPORTED_FORMATS)) {
        if (format.mimeType === mimeType) {
            return format;
        }
    }
    
    return null;
}

/**
 * Check if a file format is supported
 */
export function isSupportedFormat(filename: string, mimeType: string): boolean {
    return detectDocumentFormat(filename, mimeType) !== null;
}

/**
 * Extract images from document directory and return their paths
 */
async function extractImageAssets(workingDir: string): Promise<string[]> {
    const imagePaths: string[] = [];
    
    try {
        const files = await fs.promises.readdir(workingDir, { recursive: true });
        
        for (const file of files) {
            const filePath = String(file); // Simple type assertion
            const fullPath = path.join(workingDir, filePath);
            
            // Check if it's an image file
            const ext = path.extname(filePath).toLowerCase();
            if (['.png', '.jpg', '.jpeg', '.gif', '.svg', '.bmp', '.webp'].includes(ext)) {
                imagePaths.push(fullPath);
            }
        }
    } catch (error) {
        console.warn('Error extracting image assets:', error);
    }
    
    return imagePaths;
}

/**
 * Process HTML content to update image references with MinIO URLs
 */
function updateImageReferences(htmlContent: string, imageMapping: Record<string, string>): string {
    let updatedHtml = htmlContent;
    
    for (const [originalPath, newUrl] of Object.entries(imageMapping)) {
        const imageName = path.basename(originalPath);
        // Replace various possible image reference patterns
        const patterns = [
            new RegExp(`src="[^"]*${imageName}"`, 'g'),
            new RegExp(`src='[^']*${imageName}'`, 'g'),
            new RegExp(`src=${imageName}`, 'g')
        ];
        
        patterns.forEach(pattern => {
            updatedHtml = updatedHtml.replace(pattern, `src="${newUrl}"`);
        });
    }
    
    return updatedHtml;
}

/**
 * Execute Pandoc command to convert document to HTML
 */
async function executePandocCommand(
    inputPath: string, 
    outputPath: string, 
    format: DocumentFormat,
    extractMedia: boolean = true
): Promise<void> {
    const mediaDir = extractMedia ? path.join(path.dirname(outputPath), 'media') : undefined;
    
    let command = `pandoc -f ${format.pandocFormat} -t html --standalone --mathjax`;
    
    // Add media extraction if needed
    if (extractMedia && mediaDir) {
        command += ` --extract-media="${mediaDir}"`;
    }
    
    // Add CSS for better styling
    command += ' --css="https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/katex.min.css"';
    
    command += ` "${inputPath}" -o "${outputPath}"`;
    
    console.log('Executing Pandoc command:', command);
    
    try {
        const { stdout, stderr } = await execAsync(command);
        
        if (stderr) {
            console.warn('Pandoc stderr:', stderr);
        }
        
        console.log('Pandoc conversion completed successfully');
    } catch (error) {
        console.error('Pandoc execution failed:', error);
        throw new Error(`Pandoc conversion failed: ${error}`);
    }
}

/**
 * Main pipeline to convert document to HTML using Pandoc
 */
export async function pandocPipeline(fileUrl: string, jobId: string, originalFilename: string): Promise<string> {
    const tempDir = path.join(process.cwd(), 'pandoc_temp', crypto.randomUUID());
    
    try {
        // Create temporary directory
        await fs.promises.mkdir(tempDir, { recursive: true });
        
        await setJobProgress(jobId, {
            status: JobStatus.PROCESSING,
            message: "Downloading document for conversion"
        });
        
        // Parse MinIO URL to extract bucket and object name
        console.log(`Parsing MinIO URL: ${fileUrl}`);
        const url = new URL(fileUrl);
        const pathParts = url.pathname.split('/').filter(part => part.length > 0);
        const bucketName = pathParts[0];
        const objectName = pathParts.slice(1).join('/');
        
        console.log(`Downloading from MinIO - Bucket: ${bucketName}, Object: ${objectName}`);
        
        // Download file directly from MinIO using client credentials
        const { minioClient } = await import('./minio_upload');
        const chunks: Buffer[] = [];
        
        const stream = await minioClient.getObject(bucketName, objectName);
        
        const fileBuffer = await new Promise<Buffer>((resolve, reject) => {
            stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
            stream.on('error', reject);
            stream.on('end', () => resolve(Buffer.concat(chunks)));
        });
        
        console.log(`Successfully downloaded file from MinIO, size: ${fileBuffer.length} bytes`);
        const inputPath = path.join(tempDir, originalFilename);
        await fs.promises.writeFile(inputPath, fileBuffer);
        
        // Detect format (we don't have response headers from MinIO stream, so use empty string)
        const format = detectDocumentFormat(originalFilename, '');
        if (!format) {
            throw new Error(`Unsupported document format: ${originalFilename}`);
        }
        
        await setJobProgress(jobId, {
            status: JobStatus.PROCESSING,
            message: `Converting ${format.pandocFormat} document to HTML`
        });
        
        // Convert to HTML
        const outputPath = path.join(tempDir, 'output.html');
        await executePandocCommand(inputPath, outputPath, format, true);
        
        // Read the generated HTML
        let htmlContent = await fs.promises.readFile(outputPath, 'utf-8');
        
        // Log HTML content for debugging
        console.log(`\n=== PANDOC HTML OUTPUT (Job ${jobId}) ===`);
        console.log(`HTML length: ${htmlContent.length} characters`);
        console.log(`First 500 characters:\n${htmlContent.substring(0, 500)}...`);
        console.log(`=== END HTML OUTPUT ===\n`);
        
        await setJobProgress(jobId, {
            status: JobStatus.PROCESSING,
            message: "Processing extracted media assets"
        });
        
        // Extract and upload images
        const imagePaths = await extractImageAssets(tempDir);
        const imageMapping: Record<string, string> = {};
        
        // Upload images to MinIO and create mapping
        await Promise.all(
            imagePaths.map(async (imagePath) => {
                try {
                    const relativePath = path.relative(tempDir, imagePath);
                    const fileName = path.basename(imagePath);
                    const success = await uploadFileToMinio(imagePath, 'images', fileName);
                    if (success) {
                        const imageUrl = `${process.env.MINIO_PUBLIC_HOST}/images/${fileName}`;
                        imageMapping[relativePath] = imageUrl;
                        console.log(`Uploaded image: ${relativePath} -> ${imageUrl}`);
                    }
                } catch (error) {
                    console.warn(`Failed to upload image ${imagePath}:`, error);
                }
            })
        );
        
        // Update HTML with new image URLs
        htmlContent = updateImageReferences(htmlContent, imageMapping);
        
        // Add KaTeX CSS and ensure proper HTML structure
        if (!htmlContent.includes('katex.min.css')) {
            htmlContent = htmlContent.replace(
                '</head>',
                '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/katex.min.css"></head>'
            );
        }
        
        return htmlContent;
        
    } catch (error) {
        console.error('Pandoc pipeline failed:', error);
        throw error;
    } finally {
        // Clean up temporary directory
        try {
            await fs.promises.rm(tempDir, { recursive: true, force: true });
        } catch (error) {
            console.warn('Failed to clean up temp directory:', error);
        }
    }
}

/**
 * Get list of supported file extensions
 */
export function getSupportedExtensions(): string[] {
    return Object.values(SUPPORTED_FORMATS).map(format => format.extension);
}

/**
 * Get list of supported MIME types
 */
export function getSupportedMimeTypes(): string[] {
    return Object.values(SUPPORTED_FORMATS).map(format => format.mimeType);
}