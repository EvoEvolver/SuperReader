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

// Test file upload simulation
async function testFileUploadSimulation() {
    console.log("\n=== Testing File Upload Simulation ===");
    
    // Create a simple markdown content
    const markdownContent = `# Test Document

This is a test document for Pandoc conversion.

## Introduction

This document contains:
- Headers
- Lists  
- **Bold text**
- *Italic text*

## Mathematical Formula

The quadratic formula is: $x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$

## Code Block

\`\`\`python
def hello_world():
    print("Hello, World!")
\`\`\`

## Conclusion

This concludes our test document.
`;

    // Simulate file upload (in real scenario, you would use FormData)
    console.log("Sample markdown content created for testing:");
    console.log("Content length:", markdownContent.length, "characters");
    console.log("This would be uploaded as a .md file through /upload_document endpoint");
}

// Run tests
async function runAllTests() {
    console.log("🚀 Starting Document Processing Tests\n");
    
    await testFileUploadSimulation();
    await testDocumentUpload();
    
    console.log("\n✨ All tests completed!");
}

// Execute if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
    runAllTests().catch(console.error);
}

export { testDocumentUpload, testFileUploadSimulation };