document.addEventListener('DOMContentLoaded', function () {
    const messageDiv = document.getElementById('message');
    const sendPdfButton = document.getElementById('sendPdf');

    // Query the active tab to get its URL
    chrome.tabs.query({active: true, currentWindow: true}, function (tabs) {
        const currentTab = tabs[0];
        isPDF(currentTab.url).then((res) => {
            if (res) {
                messageDiv.textContent = 'This page is a PDF.';
                sendPdfButton.classList.remove('hidden');
            } else {
                messageDiv.textContent = 'PDF not detected.';
                sendPdfButton.classList.add('hidden');
            }
        })
    });

    sendPdfButton.addEventListener('click', () => {
        messageDiv.textContent = 'Sending PDF...';
        // In a real extension, you would get the PDF data and send it.
        // For this example, we'll just log to the background script console.
        chrome.runtime.sendMessage({action: "sendPdf"}, (response) => {
            if (chrome.runtime.lastError) {
                console.error(chrome.runtime.lastError.message);
                messageDiv.textContent = 'Failed to send.';
                return
            }
            messageDiv.textContent = response.status;
        });
    });
});

async function isPDF(url) {
    const res = await fetch(url, {method: 'HEAD'});
    const contentType = res.headers.get('content-type');
    return contentType && contentType.includes('application/pdf');
}
