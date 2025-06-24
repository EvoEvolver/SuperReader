const worker_endpoint = "https://worker.treer.ai"
//const worker_endpoint = "http://localhost:8081"

export enum JobStatus {
    PROCESSING = "processing",
    COMPLETE = "complete",
    ERROR = "error",
    FAILED = "failed"
}

export interface WaitResponse {
    tree_url: string | null;
    status: JobStatus;
    message?: string
}


export async function wait_for_result(job_id, updateWaitResponse) {
    while (true) {
        const controller = new AbortController();
        const timeout = setTimeout(() => {
            controller.abort();
        }, 30000); // 30 second timeout

        try {
            let response = await fetch(worker_endpoint + '/result', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({job_id: job_id}),
                signal: controller.signal
            });

            if (response.status === 404) {
                updateWaitResponse({
                    status: JobStatus.ERROR,
                    message: "Job id not found in server"
                })
                clearTimeout(timeout);
                throw new Error('Resource not found (404)');
            }

            const data = await response.json();
            updateWaitResponse(data)

            clearTimeout(timeout); // Clear the timeout if the request completes successfully

            if (data.tree_url) {
                return data.tree_url;
            }
            if (data.status === JobStatus.ERROR || data.status === JobStatus.FAILED) {
                return null;
            }

            await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (error) {
            clearTimeout(timeout); // Clean up the timeout
            if (error.name === 'AbortError') {
                console.log('Request timed out');
                throw new Error('Request timed out after 30 seconds');
            }
            throw error; // Re-throw other errors
        }
    }
}