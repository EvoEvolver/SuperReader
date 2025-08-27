import { createClient } from 'redis';

// Create Redis client with typing
export const redisClient = createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379',
});

// Handle Redis connection events
redisClient.on('error', (err) => {
    console.error('Redis Client Error:', err);
});

redisClient.on('connect', () => {
    console.log('Redis Client Connected');
});

// Connect to Redis
redisClient.connect().catch((err) => {
    console.warn('Redis connection failed, continuing without Redis:', err.message);
});
