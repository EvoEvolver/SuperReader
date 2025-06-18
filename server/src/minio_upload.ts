import { config } from 'dotenv';
import { Client } from 'minio';
import { basename, resolve } from 'path';
import { existsSync } from 'fs';

// Load .env variables
config();

// decompose the url into protocol, endpoint and port
const url = process.env.MINIO_ENDPOINT;
if (!url) throw new Error('MINIO_ENDPOINT environment variable is not set');

const urlParts = new URL(url);
const protocol = urlParts.protocol.replace(':', '');
const endpoint = urlParts.hostname;
const port = urlParts.port ? parseInt(urlParts.port) : (protocol === 'https' ? 443 : 80);


// MinIO client setup
export const minioClient = new Client({
  endPoint: endpoint,
  port: port,
  accessKey: process.env.MINIO_ACCESS_KEY!,
  secretKey: process.env.MINIO_SECRET_KEY!,
  useSSL: protocol === 'https',
});

export async function uploadFileToMinio(
  filePath: string,
  bucketName: string,
  objectName?: string
): Promise<boolean> {
  try {
    const resolvedPath = resolve(filePath);
    const finalObjectName = objectName ?? basename(resolvedPath);

    if (!existsSync(resolvedPath)) {
      console.error(`Error: File ${resolvedPath} does not exist`);
      return false;
    }

    const exists = await minioClient.bucketExists(bucketName);
    if (!exists) {
      await minioClient.makeBucket(bucketName);
    }

    await minioClient.fPutObject(bucketName, finalObjectName, resolvedPath, {});
    console.log(`Successfully uploaded ${resolvedPath} to ${bucketName}/${finalObjectName}`);
    return true;
  } catch (err) {
    console.error(`Error uploading file: ${(err as Error).message}`);
    return false;
  }
}