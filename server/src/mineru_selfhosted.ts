import fs from 'fs';
import path from 'path';
import axios from 'axios';
import dotenv from 'dotenv';
import AdmZip from 'adm-zip';
import MarkdownIt from 'markdown-it';
import texmath from 'markdown-it-texmath';
import {URL} from 'url';
import {uploadFileToMinio} from './minio_upload';
import katex from "katex";
import {JobStatus, setJobProgress} from "./jobStatus";
import {MongoClient, Db, Collection} from 'mongodb';
import crypto from 'crypto';

dotenv.config();

/**
 * MongoDB Caching System
 *
 * This module implements caching for MinerU PDF parsing results using MongoDB.
 *
 * How it works:
 * 1. Cache Key Generation: Combines SHA256 hash of PDF content + parsing options
 * 2. Cache Check: Before parsing, checks if result exists in MongoDB
 * 3. Cache Storage: After successful parsing, stores both markdown and HTML results
 *
 * Database: tree_gen_cache
 * Collection: mineru_parsed_pdfs
 *
 * Environment Variables:
 * - MONGO_URL: MongoDB connection string (e.g., mongodb://localhost:27017)
 *
 * Cache Entry Structure:
 * - cache_key: Unique identifier (PDF hash + options hash)
 * - pdf_path: Original PDF filename
 * - markdown_content: Processed markdown content
 * - html_content: Rendered HTML content
 * - options: Parsing options used
 * - created_at: Timestamp of cache creation
 * - image_count: Number of images processed
 */

// MongoDB connection
let mongoClient: MongoClient | null = null;
let db: Db | null = null;
let cacheCollection: Collection | null = null;

/**
 * Initialize MongoDB connection
 */
async function initMongo(): Promise<void> {
    if (mongoClient && db && cacheCollection) {
        return; // Already initialized
    }

    const mongoUrl = process.env.MONGO_URL;
    if (!mongoUrl) {
        console.warn('MONGO_URL not set, caching will be disabled');
        return;
    }

    try {
        mongoClient = new MongoClient(mongoUrl);
        await mongoClient.connect();
        db = mongoClient.db('tree_gen_cache');
        cacheCollection = db.collection('mineru_parsed_pdfs');

        // Create index on cache_key for faster lookups
        await cacheCollection.createIndex({cache_key: 1}, {unique: true});

        console.log('MongoDB cache initialized successfully');
    } catch (error) {
        console.error('Failed to initialize MongoDB cache:', error);
        mongoClient = null;
        db = null;
        cacheCollection = null;
    }
}

/**
 * Generate cache key from PDF file
 */
function generateCacheKey(pdfPath: string, options: ParseOptions): string {
    const fileBuffer = fs.readFileSync(pdfPath);
    const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    const optionsHash = crypto.createHash('sha256').update(JSON.stringify(options)).digest('hex');
    return `${fileHash}_${optionsHash}`;
}

const API_BASE_URL = process.env.MINERU_API_URL || 'https://minerudeployment-production.up.railway.app';

interface ParseOptions {
    parseFormula?: boolean;
    parseTable?: boolean;
    parseOcr?: boolean;
    dpi?: number;
    timeout?: number;
}

/**
 * Call the self-hosted /parse/sync/zip API endpoint to get ZIP file
 * @param pdfPath - Path to the PDF file
 * @param options - Parsing options
 * @returns Buffer containing the ZIP file
 */
async function callParseApi(
    pdfPath: string,
    options: ParseOptions = {}
): Promise<Buffer> {
    const {
        parseFormula = true,
        parseTable = true,
        parseOcr = true,
        dpi = 200,
        timeout = 600
    } = options;

    console.log(`Parsing PDF: ${pdfPath}`);
    console.log(`Options: formula=${parseFormula}, table=${parseTable}, ocr=${parseOcr}, dpi=${dpi}`);

    // Read the PDF file
    const fileBuffer = fs.readFileSync(pdfPath);
    const filename = path.basename(pdfPath);

    // Create form data using FormData from form-data package
    const FormData = require('form-data');
    const formData = new FormData();

    formData.append('file', fileBuffer, {
        filename: filename,
        contentType: 'application/pdf'
    });
    formData.append('parse_formula', String(parseFormula));
    formData.append('parse_table', String(parseTable));
    formData.append('parse_ocr', String(parseOcr));
    formData.append('dpi', String(dpi));

    // Send request to the API
    console.log(`Sending request to ${API_BASE_URL}/parse/sync/zip`);

    const response = await axios.post(
        `${API_BASE_URL}/parse/sync/zip`,
        formData,
        {
            headers: {
                ...formData.getHeaders()
            },
            responseType: 'arraybuffer',
            timeout: timeout * 1000,
            maxContentLength: Infinity,
            maxBodyLength: Infinity
        }
    );

    console.log('✅ PDF parsed successfully');
    console.log(`Processing time: ${response.headers['x-processing-time']}s`);

    return Buffer.from(response.data);
}

/**
 * Unzip the parsing result
 * @param zipBuffer - ZIP file buffer
 * @param pdfPath - Original PDF path (for naming)
 * @returns Path to the extracted directory
 */
function unzipResult(zipBuffer: Buffer, pdfPath: string): string {
    console.log('Extracting parsing results...');

    const zipFilename = path.basename(pdfPath, '.pdf');
    const outputDir = path.join(process.cwd(), 'pdf_result', zipFilename);

    fs.mkdirSync(outputDir, {recursive: true});

    const zip = new AdmZip(zipBuffer);
    zip.extractAllTo(outputDir, true);

    console.log(`Results extracted to: ${outputDir}`);
    return outputDir;
}

/**
 * Process markdown images and replace paths with MinIO URLs
 * @param mdPath - Path to the markdown file
 * @param urlPrefix - URL prefix for image references
 * @returns Array of original image paths
 */
function processMarkdownImages(mdPath: string, urlPrefix: string): string[] {
    const content = fs.readFileSync(mdPath, 'utf-8');
    const imageRegex = /!\[.*?\]\((.*?)\)/g;
    const originalPaths: string[] = [];

    const newContent = content.replace(imageRegex, (match, src) => {
        originalPaths.push(src);
        const filename = 'images/' + path.basename(src);
        const fullUrl = new URL(filename, urlPrefix).toString();
        return match.replace(src, fullUrl);
    });

    const processedPath = path.join(path.dirname(mdPath), 'processed.md');
    fs.writeFileSync(processedPath, newContent, 'utf-8');

    console.log(`Found ${originalPaths.length} images to process`);
    return originalPaths;
}

/**
 * Find markdown files in a directory recursively
 */
function findMarkdownFiles(dir: string): string[] {
    const results: string[] = [];
    const entries = fs.readdirSync(dir, {withFileTypes: true});

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            results.push(...findMarkdownFiles(fullPath));
        } else if (entry.name.endsWith('.md')) {
            results.push(fullPath);
        }
    }
    return results;
}

/**
 * Main pipeline to convert PDF to HTML using self-hosted MinerU API
 * @param pdfPath - Path to the PDF file
 * @param jobId - Job ID for progress tracking
 * @param options - Parsing options
 * @param returnMarkdown - Whether to return markdown instead of HTML
 * @returns HTML content or markdown content
 */
export async function mineruSelfHostedPipeline(
    pdfPath: string,
    jobId: string,
    options: ParseOptions = {},
    returnMarkdown: boolean = false
): Promise<string> {
    console.log('\n=== Starting Self-Hosted MinerU PDF to HTML Pipeline ===\n');
    console.log(`Input file: ${pdfPath}`);

    // Initialize MongoDB cache
    await initMongo();

    // Check cache if MongoDB is available
    if (cacheCollection) {
        const cacheKey = generateCacheKey(pdfPath, options);
        console.log(`Checking cache with key: ${cacheKey}`);

        const cachedResult = await cacheCollection.findOne({cache_key: cacheKey});

        if (cachedResult) {
            console.log('✅ Found cached result, skipping parsing');
            await setJobProgress(jobId, {
                status: JobStatus.PROCESSING,
                message: "Using cached result"
            });

            if (returnMarkdown) {
                return cachedResult.markdown_content;
            }
            return cachedResult.html_content;
        }

        console.log('Cache miss, proceeding with parsing');
    }

    // Step 1: Call API to get ZIP
    await setJobProgress(jobId, {
        status: JobStatus.PROCESSING,
        message: "Submitting PDF for parsing"
    });

    const zipBuffer = await callParseApi(pdfPath, options);

    await setJobProgress(jobId, {
        status: JobStatus.PROCESSING,
        message: "Parsing completed, extracting results"
    });

    // Step 2: Unzip results
    const outputDir = unzipResult(zipBuffer, pdfPath);

    // Step 3: Find the markdown file
    const mdFiles = findMarkdownFiles(outputDir);

    // Prefer files named 'full.md' or containing 'layout' in the name
    const fullMdPath = mdFiles.find(f => path.basename(f) === 'full.md') ||
        mdFiles.find(f => f.includes('_layout.md')) ||
        mdFiles[0];

    if (!fullMdPath || !fs.existsSync(fullMdPath)) {
        console.log('Available files in output:', mdFiles);
        throw new Error(`Markdown file not found in: ${outputDir}`);
    }

    console.log(`Found markdown file: ${fullMdPath}`);

    // Step 4: Process images and upload to MinIO
    await setJobProgress(jobId, {
        status: JobStatus.PROCESSING,
        message: "Processing images"
    });

    console.log('Processing images...');
    const storageUrl = process.env.MINIO_PUBLIC_HOST || 'https://storage.treer.ai/';
    const assetPaths = processMarkdownImages(fullMdPath, storageUrl);
    const processedMdPath = path.join(path.dirname(fullMdPath), 'processed.md');

    if (assetPaths.length > 0) {
        console.log('Uploading images to MinIO...');
        const mdDir = path.dirname(fullMdPath);
        await Promise.all(
            assetPaths.map(asset =>
                uploadFileToMinio(path.join(mdDir, asset), 'images')
            )
        );
        console.log('All images uploaded successfully');
    }

    // Step 5: Convert markdown to HTML
    await setJobProgress(jobId, {
        status: JobStatus.PROCESSING,
        message: "Converting to HTML"
    });

    console.log('Converting markdown to HTML...');
    const md = new MarkdownIt({html: true}).use(texmath, {
        engine: katex,
        delimiters: 'dollars',
    });

    const markdownContent = fs.readFileSync(processedMdPath, 'utf-8');

    const htmlContent = `<html>
<head>
  <meta charset="UTF-8">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/katex.min.css">
  <style>
    body {
      max-width: 900px;
      margin: 40px auto;
      padding: 0 20px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      line-height: 1.6;
      color: #333;
    }
    article {
      font-size: 16px;
    }
    img {
      max-width: 100%;
      height: auto;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      margin: 20px 0;
    }
    th, td {
      border: 1px solid #ddd;
      padding: 8px;
      text-align: left;
    }
    th {
      background-color: #f5f5f5;
    }
  </style>
</head>
<body>
  <article>${md.render(markdownContent)}</article>
</body>
</html>`;

    // Step 6: Save to cache if MongoDB is available
    if (cacheCollection) {
        try {
            const cacheKey = generateCacheKey(pdfPath, options);
            console.log('Saving result to cache...');
            await cacheCollection.insertOne({
                cache_key: cacheKey,
                pdf_path: path.basename(pdfPath),
                markdown_content: markdownContent,
                html_content: htmlContent,
                options: options,
                created_at: new Date(),
                image_count: assetPaths.length
            });
            console.log('✅ Result cached successfully');
        } catch (error) {
            console.error('Failed to cache result:', error);
            // Continue execution even if caching fails
        }
    }

    // Step 7: Clean up temporary directory
    console.log('Cleaning up temporary files...');
    await fs.promises.rm(outputDir, {recursive: true, force: true});

    console.log('\n=== Pipeline completed successfully! ===\n');

    if (returnMarkdown) {
        return markdownContent;
    }
    return htmlContent;
}

/**
 * Simple function to just get the ZIP file
 * @param pdfPath - Path to the PDF file
 * @param options - Parsing options
 * @returns Buffer containing the ZIP file
 */
export async function parsePdfToZip(
    pdfPath: string,
    options: ParseOptions = {}
): Promise<Buffer> {
    return await callParseApi(pdfPath, options);
}

/**
 * Parse PDF and save ZIP to file
 * @param pdfPath - Path to the PDF file
 * @param outputPath - Path where to save the ZIP file
 * @param options - Parsing options
 */
export async function parsePdfAndSaveZip(
    pdfPath: string,
    outputPath: string,
    options: ParseOptions = {}
): Promise<void> {
    const zipBuffer = await callParseApi(pdfPath, options);
    fs.writeFileSync(outputPath, zipBuffer);
    console.log(`ZIP file saved to: ${outputPath}`);
}
