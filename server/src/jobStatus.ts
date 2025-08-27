import {redisClient} from "./redis";

export enum JobStatus {
    PROCESSING = "processing",
    COMPLETE = "complete",
    ERROR = "error",
    FAILED = "failed"
}

export interface JobProgress {
    status: JobStatus,
    message?: string,
    treeUrl?: string
}


export async function setJobProgress(jobId: string, result: JobProgress): Promise<void> {
    try {
        await redisClient.set("tree_worker_job_status-" + jobId, JSON.stringify(result));
    } catch (error) {
        console.warn('Redis set failed, using fallback storage:', error);
        // Fallback to memory storage for development
        jobStatusCache.set(jobId, result);
    }
}

export async function getJobProgress(jobId: string): Promise<JobProgress | null> {
    try {
        const result = await redisClient.get("tree_worker_job_status-" + jobId);
        if (!result) {
            return jobStatusCache.get(jobId) || null;
        }
        return JSON.parse(result.toString()) as JobProgress;
    } catch (error) {
        console.warn('Redis get failed, using fallback storage:', error);
        return jobStatusCache.get(jobId) || null;
    }
}

// Fallback in-memory storage for development
const jobStatusCache = new Map<string, JobProgress>();