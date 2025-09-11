import { Client } from 'minio';
import { basename, resolve } from 'path';
import { existsSync } from 'fs';
import { getMinioConfig } from './config';

// MinIO client setup using centralized configuration
const minioConfig = getMinioConfig();

export const minioClient = new Client({
  endPoint: minioConfig.endPoint,
  accessKey: minioConfig.accessKey,
  secretKey: minioConfig.secretKey,
  useSSL: minioConfig.useSSL,
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