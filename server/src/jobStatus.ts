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


import {redisClient} from "./redis";

export async function setJobProgress(jobId: string, result: JobProgress): Promise<void> {
    await redisClient.set("tree_worker_job_status-"+jobId, JSON.stringify(result));
}

export async function getJobProgress(jobId: string): Promise<JobProgress | null> {
    const result = await redisClient.get("tree_worker_job_status-"+jobId);
    if (!result) {
        return null;
    }
    // @ts-ignore
    return JSON.parse(result) as JobProgress;
}