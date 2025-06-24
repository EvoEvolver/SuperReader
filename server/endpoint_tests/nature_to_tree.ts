import axios from 'axios';
import open from 'open';


const paper_url = "https://www.nature.com/articles/s41557-025-01815-x"

let html_source: string;

async function fetchHtmlContent() {
    try {
        const response = await axios.get(paper_url);
        html_source = response.data;
        return html_source;
    } catch (error) {
        console.error('Error fetching HTML content:', error);
        throw error;
    }
}

const endpointHost = "http://localhost:8081"
const clientHost = "http://localhost:5173"

fetchHtmlContent().then((html_source) => {
    axios.post(endpointHost+'/submit/nature_to_tree', {
        paper_url: paper_url,
        html_source: html_source
    }).then(async (res) => {
        const job_id = res.data["job_id"]
        await open(`${clientHost}?job_id=${job_id}`);
    }).catch(error => {
        console.error('Error in processing:', error);
    });
}).catch(error => {
    console.error('Error fetching HTML:', error);
});