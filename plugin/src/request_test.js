import { sendTreeReaderRequest, pushToForestService } from './requests.js';

const link = "https://link.springer.com/article/10.1007/s10462-024-10896-y";

fetch(link)
    .then(response => response.text())
    .then(htmlSource => {
        return sendTreeReaderRequest(htmlSource, link);
    })
    .catch(error => {
        console.error("Error:", error);
    });