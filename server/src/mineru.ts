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

dotenv.config();

async function submitParsingJob(fileUrl: string): Promise<string> {
    const url = 'https://mineru.net/api/v4/extract/task';
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.MINERU_TOKEN}`,
    };
    const data = {
        url: fileUrl,
        is_ocr: true,
        enable_formula: true,
        enable_table: true,
        language: 'en',
        extra_formats: ['html'],
    };

    const res = await axios.post(url, data, {headers});
    if (res.data?.data?.task_id) {
        return res.data.data.task_id;
    }
    throw new Error(`Invalid response: task_id not found. Response data: ${JSON.stringify(res.data)}`);
}

async function waitForParsingResult(taskId: string): Promise<string> {
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.MINERU_TOKEN}`,
    };

    const request_period = 2000 // 2s
    const max_time_to_wait = 10 * 60 * 1000 // 10min
    let time_waited = 0
    while (true) {
        const res = await axios.get(`https://mineru.net/api/v4/extract/task/${taskId}`, {headers});
        const state = res.data.data.state;
        console.log(res.data);

        if (state === 'done') return res.data.data.full_zip_url;
        if (state === 'failed') throw new Error('Parsing failed.');
        await new Promise(resolve => setTimeout(resolve, request_period));
        time_waited += request_period
        if (time_waited > max_time_to_wait) {
            throw new Error('Parsing failed.');
        }
    }
}

async function downloadAndUnzipResult(zipUrl: string): Promise<string> {
    const response = await axios.get(zipUrl, {responseType: 'arraybuffer'});
    if (response.status !== 200) throw new Error(`Download failed: ${response.status}`);

    const zipData = response.data;
    const zipFilename = path.basename(zipUrl, '.zip');
    const outputDir = path.join(process.cwd(), 'pdf_result', zipFilename);
    fs.mkdirSync(outputDir, {recursive: true});

    const zip = new AdmZip(zipData);
    zip.extractAllTo(outputDir, true);
    return outputDir;
}

function processMarkdownImages(mdPath: string, urlPrefix: string): string[] {
    const content = fs.readFileSync(mdPath, 'utf-8');
    const imageRegex = /!\[.*?\]\((.*?)\)/g;
    const originalPaths: string[] = [];

    const newContent = content.replace(imageRegex, (match, src) => {
        originalPaths.push(src);
        const filename = "images/" + path.basename(src);
        const fullUrl = new URL(filename, urlPrefix).toString();
        return match.replace(src, fullUrl);
    });

    const processedPath = path.join(path.dirname(mdPath), 'processed.md');
    fs.writeFileSync(processedPath, newContent, 'utf-8');
    return originalPaths;
}

export async function mineruPipeline(fileUrl: string) {
    const taskId = await submitParsingJob(fileUrl);
    const resultUrl = await waitForParsingResult(taskId);
    const outputDir = await downloadAndUnzipResult(resultUrl);
    const fullMdPath = path.join(outputDir, 'full.md');

    const assetPaths = processMarkdownImages(fullMdPath, 'https://storage.treer.ai/');
    const processedMdPath = path.join(outputDir, 'processed.md');

    await Promise.all(
        assetPaths.map(asset =>
            uploadFileToMinio(path.join(outputDir, asset), 'images')
        )
    );

    const md = new MarkdownIt({html: true}).use(texmath, {
        engine: katex,
        delimiters: 'dollars',
    });
    const markdownContent = fs.readFileSync(processedMdPath, 'utf-8');
    const htmlContent = `<html><head><meta charset="UTF-8"><link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.8/dist/katex.min.css"></head><body><article>${md.render(markdownContent)}</article></body></html>`;

    // remove the directory outputDir
    await fs.promises.rm(outputDir, {recursive: true, force: true});

    //fs.writeFileSync(path.join(outputDir, 'processed.html'), htmlContent, 'utf-8');
    return htmlContent
}