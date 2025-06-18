import axios from 'axios';


axios.post('http://localhost:8081/submit/pdf_to_tree', {
    file_url: "http://console-production-8e5e.up.railway.app/api/v1/download-shared-object/aHR0cDovL2J1Y2tldC5yYWlsd2F5LmludGVybmFsOjkwMDAvdHJlZXIvc251cnItZXQtYWwtMTk5Ny1hZHNvcnB0aW9uLW9mLWNoNC1jZjQtbWl4dHVyZXMtaW4tc2lsaWNhbGl0ZS1zaW11bGF0aW9uLWV4cGVyaW1lbnQtYW5kLXRoZW9yeS5wZGY_WC1BbXotQWxnb3JpdGhtPUFXUzQtSE1BQy1TSEEyNTYmWC1BbXotQ3JlZGVudGlhbD0zTUZSTzFPTE05QkhDT0tHSlNRWiUyRjIwMjUwNjE3JTJGdXMtZWFzdC0xJTJGczMlMkZhd3M0X3JlcXVlc3QmWC1BbXotRGF0ZT0yMDI1MDYxN1QyMTAwNTdaJlgtQW16LUV4cGlyZXM9NDMyMDAmWC1BbXotU2VjdXJpdHktVG9rZW49ZXlKaGJHY2lPaUpJVXpVeE1pSXNJblI1Y0NJNklrcFhWQ0o5LmV5SmhZMk5sYzNOTFpYa2lPaUl6VFVaU1R6RlBURTA1UWtoRFQwdEhTbE5SV2lJc0ltVjRjQ0k2TVRjMU1ESXlNRFl5T0N3aWNHRnlaVzUwSWpvaWVtbHFhV0Z1SW4wLkxSWG1KS2pWUVNvdE9mZlFpSHdSNmZwU1VWU19CR0p3SXM1R1RTTVZCZFBfamFyTlJyOGZkS3VPN0t2Sm1QajNoT2I3RmRZNDVDR2lOUE8yV0dlcXlnJlgtQW16LVNpZ25lZEhlYWRlcnM9aG9zdCZ2ZXJzaW9uSWQ9bnVsbCZYLUFtei1TaWduYXR1cmU9MWNlNDQ4OTFmY2Y5MzdhMmY4MmQ5YWQ1NjczNzVmNzFhZGYzM2Q5Y2Y5MDNjMmJlNGY5MWUxMGVjZmQzNDY3Ng"
}).then(async (res) => {
    const job_id = res.data["job_id"]
    while (true) {
        let result = await axios.post('http://localhost:8081/result', {job_id: job_id})
        console.log(result.data)
        await new Promise(resolve => setTimeout(resolve, 1000));
        if(result.data["tree_url"]){
            break
        }
    }
})