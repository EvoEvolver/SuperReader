import axios from 'axios';


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

const hostname = "https://htmlworker.treer.ai"
//const hostname = "http://localhost:8081"

fetchHtmlContent().then((html_source) => {
    axios.post(hostname+'/submit/nature_to_tree', {
        paper_url: paper_url,
        html_source: html_source
    }).then(async (res) => {
        const job_id = res.data["job_id"]
    while (true) {
        let result = await axios.post(hostname+'/result', {job_id: job_id})
        console.log(result.data)
        await new Promise(resolve => setTimeout(resolve, 1000));
        if(result.data["tree_url"]){
            break
        }
    }
    }).catch(error => {
        console.error('Error in processing:', error);
    });
}).catch(error => {
    console.error('Error fetching HTML:', error);
});