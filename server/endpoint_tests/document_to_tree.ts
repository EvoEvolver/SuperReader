import axios from 'axios';

const hostname = "http://localhost:8081"

// Test document upload and processing
async function testDocumentUpload() {
    console.log("Testing document upload and processing...");
    
    try {
        // First, get supported formats
        const formatsResponse = await axios.get(hostname + '/supported_formats');
        console.log("Supported formats:", formatsResponse.data);
        
        // Test with a sample markdown file URL (you would replace this with actual file upload)
        const testFileUrl = "https://raw.githubusercontent.com/microsoft/vscode/main/README.md";
        
        console.log("Testing with sample markdown file:", testFileUrl);
        
        // Submit document for processing
        const submitResponse = await axios.post(hostname + '/submit/document_to_tree', {
            file_url: testFileUrl,
            file_type: "document",
            original_filename: "README.md"
        });
        
        console.log("Submit response:", submitResponse.data);
        const job_id = submitResponse.data["job_id"];
        
        // Poll for results
        console.log("Polling for results...");
        while (true) {
            let result = await axios.post(hostname + '/result', {job_id: job_id});
            console.log("Status:", result.data);
            
            if (result.data["treeUrl"]) {
                console.log("✅ Document processing completed successfully!");
                console.log("Tree URL:", result.data["treeUrl"]);
                break;
            }
            
            if (result.data["status"] === "ERROR" || result.data["status"] === "FAILED") {
                console.log("❌ Document processing failed:", result.data["message"]);
                break;
            }
            
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
        
    } catch (error) {
        console.error("❌ Test failed:", error.response?.data || error.message);
    }
}

// Test document upload and processing with userid
async function testDocumentUploadWithUserId() {
    console.log("Testing document upload and processing with userid...");
    
    try {
        // First, get supported formats
        const formatsResponse = await axios.get(hostname + '/supported_formats');
        console.log("Supported formats:", formatsResponse.data);
        
        // Test with a sample markdown file URL (you would replace this with actual file upload)
        const testFileUrl = "https://raw.githubusercontent.com/microsoft/vscode/main/README.md";
        
        console.log("Testing with sample markdown file and userid:", testFileUrl);
        
        // Submit document for processing with userid
        const submitResponse = await axios.post(hostname + '/submit/document_to_tree', {
            file_url: testFileUrl,
            file_type: "document",
            original_filename: "README.md",
            userid: "test-user-123"
        });
        
        console.log("Submit response:", submitResponse.data);
        const job_id = submitResponse.data["job_id"];
        
        // Poll for results
        console.log("Polling for results...");
        while (true) {
            let result = await axios.post(hostname + '/result', {job_id: job_id});
            console.log("Status:", result.data);
            
            if (result.data["treeUrl"]) {
                console.log("✅ Document processing with userid completed successfully!");
                console.log("Tree URL:", result.data["treeUrl"]);
                break;
            }
            
            if (result.data["status"] === "ERROR" || result.data["status"] === "FAILED") {
                console.log("❌ Document processing with userid failed:", result.data["message"]);
                break;
            }
            
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
        
    } catch (error) {
        console.error("❌ Test with userid failed:", error.response?.data || error.message);
    }
}


// Run tests
async function runAllTests() {
    console.log("🚀 Starting Document Processing Tests\n");
    await testDocumentUpload();
    await testDocumentUploadWithUserId();
    
    console.log("\n✨ All tests completed!");
}

// Execute if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
    runAllTests().catch(console.error);
}

export { testDocumentUpload, testDocumentUploadWithUserId };