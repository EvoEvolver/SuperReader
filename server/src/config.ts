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
        chatModel: process.env.OPENAI_CHAT_MODEL || 'gpt-5-mini',
        imageModel: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1'
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
    const required = [
        { key: 'OPENAI_API_KEY', value: config.openai.apiKey },
        { key: 'MINIO_ACCESS_KEY', value: config.minio.accessKey },
        { key: 'MINIO_SECRET_KEY', value: config.minio.secretKey },
    ];

    const missing = required.filter(item => !item.value);

    if (missing.length > 0) {
        console.error('❌ Missing required environment variables:');
        missing.forEach(item => console.error(`   - ${item.key}`));
        console.error('Please check your .env file and ensure all required variables are set.');
        process.exit(1);
    }

    console.log('✅ Configuration validated successfully');
    console.log(`📊 Using OpenAI model: ${config.openai.chatModel} (temp: ${config.openai.temperature})`);
    console.log(`🖼️  Using image model: ${config.openai.imageModel}`);
    console.log(`🎨 Reference image: ${config.imageEdit.referenceImageUrl}`);
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
    return {
        endPoint: config.minio.endpoint.replace(/^https?:\/\//, ''),
        useSSL: config.minio.endpoint.startsWith('https'),
        accessKey: config.minio.accessKey,
        secretKey: config.minio.secretKey,
    };
}

export default config;