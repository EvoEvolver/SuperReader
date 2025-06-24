let appState = {
    pageList: []
}
let loadingPages = [];

// Modified message listener for 'sendNatureToTreeRequest'
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'sendNatureToTreeRequest') {
        // Handle the async operation
        (async () => {
            if (loadingPages.includes(message.url)) {
                sendResponse({status: "error", message: "Already processing this page."});
                return;
            }
            try {
                loadingPages.push(message.url);
                const tree_url = await sendNatureToTreeRequest(message.html, message.url);
                appState.pageList.push({
                    readerLink: tree_url,
                });
                sendResponse({status: "success", readerLink: tree_url, message: 'Tree reader ready!'});
                // open the link in a new tab
                chrome.tabs.create({url: tree_url});
                loadingPages = loadingPages.filter(url => url !== message.url);
            } catch (error) {
                // remove the url from loadingPages
                loadingPages = loadingPages.filter(url => url !== message.url);
                sendResponse({status: "error", message: error.message});
            }
        })();
        return true; // Will respond asynchronously
    }
});

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


// Listen for messages from the popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "sendPdf") {
        console.log("Request to send PDF received.");

        // Convert to async/await for clearer handling
        (async () => {
            try {
                const tabs = await chrome.tabs.query({active: true, currentWindow: true});
                const pdfUrl = tabs[0].url;

                // Download PDF
                const response = await fetch(pdfUrl);
                const pdfBlob = await response.blob();

                // Create and send FormData
                const formData = new FormData();
                formData.append('file', pdfBlob, 'document.pdf');

                const uploadResponse = await fetch(worker_endpoint + '/upload_pdf', {
                    method: 'POST',
                    body: formData
                });

                const data = await uploadResponse.json();

                if (data.status !== "success") {
                    sendResponse({status: "Failed to send PDF"});
                    return;
                }

                console.log('Success:', data);
                sendResponse({status: "PDF sent successfully!"});
                await sendPdfToTreeRequest(data["url"], sendResponse);

            } catch (error) {
                console.error('Error:', error);
                sendResponse({status: "Failed to send PDF."});
            }
        })();

        return true; // Indicate we will send response asynchronously
    }
});

async function sendPdfToTreeRequest(pdf_url, sendResponse) {
    await fetch(worker_endpoint + '/submit/pdf_to_tree', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            file_url: pdf_url
        })
    })
        .then(response => response.json())
        .then(async data => {
            if (data.status !== "success") {
                sendResponse({status: "Job submission failed"});
                return
            }
            const job_id = data["job_id"]
            const tree_url = await wait_for_result(job_id)
            if (tree_url) {
                chrome.tabs.create({url: tree_url});
            }
        });
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

// Set up default icons. This is good practice.
chrome.runtime.onInstalled.addListener(() => {
    console.log('PDF Detector extension installed.');
});
