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

// Test DOC document processing
async function testDocUpload() {
    console.log("\n=== Testing DOC Document Processing ===");
    
    try {
        // Using a sample DOC file URL - W3C test document
        const testDocUrl = "https://www.learningcontainer.com/wp-content/uploads/2019/09/sample-doc-file.doc";
        
        console.log("Testing with sample DOC file:", testDocUrl);
        
        // Submit DOC document for processing
        const submitResponse = await axios.post(hostname + '/submit/document_to_tree', {
            file_url: testDocUrl,
            file_type: "document",
            original_filename: "sample.doc"
        });
        
        console.log("Submit response:", submitResponse.data);
        const job_id = submitResponse.data["job_id"];
        
        // Poll for results
        console.log("Polling for DOC processing results...");
        while (true) {
            let result = await axios.post(hostname + '/result', {job_id: job_id});
            console.log("DOC Status:", result.data);
            
            if (result.data["treeUrl"]) {
                console.log("✅ DOC processing completed successfully!");
                console.log("Tree URL:", result.data["treeUrl"]);
                break;
            }
            
            if (result.data["status"] === "ERROR" || result.data["status"] === "FAILED") {
                console.log("❌ DOC processing failed:", result.data["message"]);
                break;
            }
            
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
        
    } catch (error) {
        console.error("❌ DOC test failed:", error.response?.data || error.message);
    }
}

// Test DOCX document processing
async function testDocxUpload() {
    console.log("\n=== Testing DOCX Document Processing ===");
    
    try {
        // Using a sample DOCX file URL - Learning Container test document
        const testDocxUrl = "https://www.learningcontainer.com/wp-content/uploads/2019/09/sample-docx-file.docx";
        
        console.log("Testing with sample DOCX file:", testDocxUrl);
        
        // Submit DOCX document for processing
        const submitResponse = await axios.post(hostname + '/submit/document_to_tree', {
            file_url: testDocxUrl,
            file_type: "document",
            original_filename: "sample.docx"
        });
        
        console.log("Submit response:", submitResponse.data);
        const job_id = submitResponse.data["job_id"];
        
        // Poll for results
        console.log("Polling for DOCX processing results...");
        while (true) {
            let result = await axios.post(hostname + '/result', {job_id: job_id});
            console.log("DOCX Status:", result.data);
            
            if (result.data["treeUrl"]) {
                console.log("✅ DOCX processing completed successfully!");
                console.log("Tree URL:", result.data["treeUrl"]);
                break;
            }
            
            if (result.data["status"] === "ERROR" || result.data["status"] === "FAILED") {
                console.log("❌ DOCX processing failed:", result.data["message"]);
                break;
            }
            
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
        
    } catch (error) {
        console.error("❌ DOCX test failed:", error.response?.data || error.message);
    }
}

// Run tests
async function runAllTests() {
    console.log("🚀 Starting Document Processing Tests\n");
    
    await testFileUploadSimulation();
    await testDocumentUpload();
    await testDocUpload();
    await testDocxUpload();
    
    console.log("\n✨ All tests completed!");
}

// Execute if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
    runAllTests().catch(console.error);
}

export { testDocumentUpload, testFileUploadSimulation };