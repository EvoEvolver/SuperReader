import { config } from 'dotenv';
import { Client } from 'minio';
import { basename, resolve } from 'path';
import { existsSync } from 'fs';

// Load .env variables
config();

// MinIO client setup
const minioClient = new Client({
  endPoint: process.env.MINIO_ENDPOINT!,
  accessKey: process.env.MINIO_ACCESS_KEY!,
  secretKey: process.env.MINIO_SECRET_KEY!,
  useSSL: true,
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