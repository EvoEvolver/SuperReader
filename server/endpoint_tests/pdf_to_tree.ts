import axios from 'axios';

const hostname = "http://localhost:8081"

axios.post(hostname + '/submit/pdf_to_tree', {
    file_url: "http://console-production-8e5e.up.railway.app/api/v1/download-shared-object/aHR0cDovL2J1Y2tldC5yYWlsd2F5LmludGVybmFsOjkwMDAvcGRmL2Y5NTIwMTFmYjQ4ZjRiZDg4YTJlMjgxMjg1MDI4MjNmMmUwMjMyNzNhZmZmNGFhOWEyNGZiYmJjZjQ4MjM1ZTEucGRmP1gtQW16LUFsZ29yaXRobT1BV1M0LUhNQUMtU0hBMjU2JlgtQW16LUNyZWRlbnRpYWw9RUQxRFE3U1NNWEhYT1JYRVk4Q1YlMkYyMDI1MDYxOSUyRnVzLWVhc3QtMSUyRnMzJTJGYXdzNF9yZXF1ZXN0JlgtQW16LURhdGU9MjAyNTA2MTlUMDExNDA2WiZYLUFtei1FeHBpcmVzPTQzMjAwJlgtQW16LVNlY3VyaXR5LVRva2VuPWV5SmhiR2NpT2lKSVV6VXhNaUlzSW5SNWNDSTZJa3BYVkNKOS5leUpoWTJObGMzTkxaWGtpT2lKRlJERkVVVGRUVTAxWVNGaFBVbGhGV1RoRFZpSXNJbVY0Y0NJNk1UYzFNRE14TWpVMU1Td2ljR0Z5Wlc1MElqb2llbWxxYVdGdUluMC5QQkg5ZFVRWEFqalFpNmQ4UjZSU2k2U1p1QnhUUjVVQy1VUndRaG5kNnJ5ZV9HVlQ0UldPckNiN0haWFozV3ZJZUg1STVXR2lFdmFscFhhQjJOR0gxQSZYLUFtei1TaWduZWRIZWFkZXJzPWhvc3QmdmVyc2lvbklkPW51bGwmWC1BbXotU2lnbmF0dXJlPTlkYWFkYTdjYWI5NzUzMTMxYTYxZGIzMTZjNmMwMWUwMDczNWRjZmQ1MmZmYWEwOGQ5NWQ0OGU2ZGFjZDk1ODM"
}).then(async (res) => {
    const job_id = res.data["job_id"]
    while (true) {
        let result = await axios.post(hostname + '/result', {job_id: job_id})
        console.log(result.data)
        await new Promise(resolve => setTimeout(resolve, 1000));
        if (result.data["tree_url"]) {
            break
        }
    }
})