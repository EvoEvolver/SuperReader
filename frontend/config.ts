// Auto-detect environment based on current URL
function getWorkerEndpoint() {
    const hostname = window.location.hostname;
    
    // Check if we're running on localhost or local development environment
    if (hostname === 'localhost' || 
        hostname === '127.0.0.1' || 
        hostname.startsWith('192.168.') || 
        hostname.startsWith('10.0.') ||
        hostname.endsWith('.local')) {
        return "http://localhost:8081";
    }
    
    // Production environment
    return "https://worker.treer.ai";
}

export const worker_endpoint = getWorkerEndpoint();