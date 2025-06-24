

const worker_endpoint = "https://worker.treer.ai"

async function sendNatureToTreeRequest(html_source, paper_url) {
    console.log("sending message to worker");
    const response = await fetch(worker_endpoint + '/submit/nature_to_tree', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            html_source: html_source,
            paper_url: paper_url
        })
    });

    const responseData = await response.json();
    console.log("response received", responseData);

    const job_id = responseData.job_id;

    const tree_url = await wait_for_result(job_id);
    if (tree_url) {
        return tree_url;
    } else {
        throw new Error("no tree generated");
    }
}

async function wait_for_result(job_id) {
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

            const data = await response.json();
            console.log(data);

            clearTimeout(timeout); // Clear the timeout if the request completes successfully

            if (data.tree_url) {
                return data.tree_url;
            }
            if (data.status === "error" || data.status === "failed") {
                return null;
            }

            await new Promise(resolve => setTimeout(resolve, 1000));
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