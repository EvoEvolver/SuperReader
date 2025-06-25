const worker_endpoint = "https://worker.treer.ai"


// Modified message listener for 'sendNatureToTreeRequest'
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'sendNatureToTreeRequest') {
        // Handle the async operation
        (async () => {
            try {
                const job_id = await sendNatureToTreeRequest(message.html, message.url);
                sendResponse({status: "success", message: "Job created. Click to go to worker page", job_id: job_id});
                // open the link in a new tab
                chrome.tabs.create({url: getWaitingPageUrl(job_id)});
            } catch (error) {
                sendResponse({status: "error", message: error.message});
            }
        })();
        return true; // Will respond asynchronously
    }
});


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
    return responseData.job_id;
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

                const job_id = await sendPdfToTreeRequest(data["url"]);
                chrome.tabs.create({url: getWaitingPageUrl(job_id)});

            } catch (error) {
                console.error('Error:', error);
                sendResponse({status: "Failed to send PDF."});
            }
        })();

        return true; // Indicate we will send response asynchronously
    }
});

async function sendPdfToTreeRequest(pdf_url) {
    const response = await fetch(worker_endpoint + '/submit/pdf_to_tree', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            file_url: pdf_url
        })
    }).then(response => response.json())
    return response["job_id"]
}


function getWaitingPageUrl(job_id) {
    return `${worker_endpoint}/wait?job_id=${encodeURIComponent(job_id)}`
}

// Set up default icons. This is good practice.
chrome.runtime.onInstalled.addListener(() => {
    console.log('PDF Detector extension installed.');
});
