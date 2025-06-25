const worker_endpoint = "https://worker.treer.ai";
let nQueryToTry = 7;

function waitForElements() {
    const mainContent = document.querySelector(".main-content");
    const articleTitle = document.querySelector(".c-article-title");

    if (mainContent && articleTitle) {
        console.log("✅ Elements found. Injecting button.");
        const button = document.createElement("div");
        button.textContent = "View in Tree!";
        button.className = "tree-reader-button";
        button.id = "tree-reader-button";
        articleTitle.insertAdjacentElement("afterend", button);
        button.addEventListener("click", processNaturePage);
        const statusElement = document.createElement("div");
        statusElement.id = "tree-reader-status"
        button.insertAdjacentElement("afterend", statusElement);
        clearInterval(checker); // stop checking once done
    }

    nQueryToTry--;
    if (nQueryToTry <= 0) {
        //console.log("❌ Elements not found. Stopping checks.");
        clearInterval(checker); // stop checking after n tries
    }
}

const checker = setInterval(waitForElements, 1000); // check every 500ms


async function processNaturePage() {
    try {
        let currentURL = window.location.href;
        let htmlContent = document.documentElement.outerHTML;

        if (htmlContent) {
            updateStatus({
                status: "loading",
                message: "Request sent"
            });
            const button = document.querySelector("#tree-reader-button");
            // disable click
            button.removeEventListener("click", processNaturePage)
            // Send the HTML to the background script for the HTTP request
            chrome.runtime.sendMessage({
                action: 'sendNatureToTreeRequest',
                url: currentURL,
                html: htmlContent,
            }, (response) => {
                if (response)
                    updateStatus(response);
            });
        } else {
            updateStatus({
                status: "error",
                message: "Error occurred"
            });
            console.log(error)
        }
    } catch (error) {
        updateStatus({
            status: "error",
            message: "Error occurred"
        });
        console.log(error)
    }
}

function updateStatus(status) {
    const statusElement = document.getElementById('tree-reader-button');
    statusElement.textContent = status.message;
    const type = status.status
    statusElement.style.backgroundColor = type === 'error' ? 'red' :
        type === 'success' ? 'green' :
            type === 'loading' ? 'blue' : '#666';
    if(type==="success"){
        // add a link to statusElement
        const link = getWaitingPageUrl(status.job_id)
        statusElement.style.cursor = 'pointer';
        statusElement.addEventListener('click', () => {
            window.open(link, '_blank');
        });
    }
}
function getWaitingPageUrl(job_id) {
    return `${worker_endpoint}/wait?job_id=${encodeURIComponent(job_id)}`
}
if (window.location.href.endsWith('.pdf') || document.contentType === 'application/pdf') {
    chrome.runtime.sendMessage({type: "PDF_DETECTED", url: window.location.href});
}