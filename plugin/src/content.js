
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
            updateStatus('Preparing...(reader will popup by itself)', 'loading');
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
                    updateStatus(response.message, response.status);
            });
        } else {
            updateStatus('Failed to get page HTML', 'error');
        }
    } catch (error) {
        updateStatus(`Error: ${error.message}`, 'error');
    }
}

function updateStatus(message, type) {
    const statusElement = document.getElementById('tree-reader-button');
    statusElement.textContent = message;
    statusElement.style.backgroundColor = type === 'error' ? 'red' :
        type === 'success' ? 'green' :
            type === 'loading' ? 'blue' : '#666';
}

if (window.location.href.endsWith('.pdf') || document.contentType === 'application/pdf') {
  chrome.runtime.sendMessage({ type: "PDF_DETECTED", url: window.location.href });
}