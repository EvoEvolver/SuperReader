import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

/**
 * Centralized configuration with fallback defaults
 */
export const config = {
    // OpenAI Configuration
    openai: {
        apiKey: process.env.OPENAI_API_KEY || '',
        chatModel: process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini',
        imageModel: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1',
        temperature: parseFloat(process.env.OPENAI_TEMPERATURE || '0.5'),
    },

    // MinIO Configuration
    minio: {
        endpoint: process.env.MINIO_ENDPOINT || 'https://storage.treer.ai',
        publicHost: process.env.MINIO_PUBLIC_HOST || 'https://storage.treer.ai',
        accessKey: process.env.MINIO_ACCESS_KEY || '',
        secretKey: process.env.MINIO_SECRET_KEY || '',
    },

    // Image Edit Service Configuration
    imageEdit: {
        referenceImageUrl: process.env.REFERENCE_IMAGE_URL || 'https://storage.treer.ai/images/2fb397e8-9e0c-44a8-97f7-9f78ac42045e.png',
        minioBucket: 'images',
        tempDir: 'temp',
        maxFileSize: 50 * 1024 * 1024, // 50MB
    },

    // Redis Configuration
    redis: {
        url: process.env.REDIS_URL || 'redis://localhost:6379',
    },

    // MinerU Configuration
    minerU: {
        token: process.env.MINERU_TOKEN || '',
    },

    // Server Configuration
    server: {
        port: parseInt(process.env.PORT || '8081'),
        frontendDir: process.env.FRONTEND_DIR || '../frontend/dist',
    },
};

/**
 * Validate required configuration
 */
export function validateConfig(): void {
    const warnings = [];
    const errors = [];

    // Check critical environment variables
    if (!config.openai.apiKey) {
        warnings.push('OPENAI_API_KEY is not set - OpenAI features will not work');
    }
    
    if (!config.minio.accessKey || !config.minio.secretKey) {
        warnings.push('MinIO credentials not set - file upload features may not work');
    }

    // Only exit for truly critical errors that prevent startup
    if (errors.length > 0) {
        console.error('❌ Critical configuration errors:');
        errors.forEach(error => console.error(`   - ${error}`));
        process.exit(1);
    }

    // Just warn for missing optional features
    if (warnings.length > 0) {
        console.warn('⚠️  Configuration warnings:');
        warnings.forEach(warning => console.warn(`   - ${warning}`));
    }

    console.log('✅ Configuration validated successfully');
    console.log(`📊 Using OpenAI model: ${config.openai.chatModel} (temp: ${config.openai.temperature})`);
    console.log(`🖼️  Using image model: ${config.openai.imageModel}`);
    console.log(`🎨 Reference image: ${config.imageEdit.referenceImageUrl}`);
    console.log(`🗂️  MinIO endpoint: ${config.minio.endpoint}`);
}

/**
 * Get OpenAI chat model configuration
 */
export function getChatModelConfig() {
    return {
        model: config.openai.chatModel,
        temperature: config.openai.temperature,
        apiKey: config.openai.apiKey,
    };
}

/**
 * Get MinIO configuration
 */
export function getMinioConfig() {
    const endpoint = config.minio.endpoint;
    
    // Handle both URL format and plain hostname:port format
    try {
        // Try to parse as URL first
        const url = new URL(endpoint.startsWith('http') ? endpoint : `https://${endpoint}`);
        return {
            endPoint: url.hostname,
            port: url.port ? parseInt(url.port) : (url.protocol === 'https:' ? 443 : 80),
            useSSL: url.protocol === 'https:',
            accessKey: config.minio.accessKey,
            secretKey: config.minio.secretKey,
        };
    } catch (error) {
        // Fallback: parse manually for formats like "hostname:port"
        const parts = endpoint.split(':');
        const hostname = parts[0];
        const port = parts[1] ? parseInt(parts[1]) : 443;
        const useSSL = port === 443 || endpoint.startsWith('https');
        
        console.log(`[Config] MinIO endpoint parsed: ${hostname}:${port} (SSL: ${useSSL})`);
        
        return {
            endPoint: hostname,
            port: port,
            useSSL: useSSL,
            accessKey: config.minio.accessKey,
            secretKey: config.minio.secretKey,
        };
    }
}

export default config;