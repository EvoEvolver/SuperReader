# Initialize Redis client
import os

from redis import Redis

redis_host = os.environ.get("REDIS_URL", "localhost")
redis_client = Redis.from_url(redis_host, decode_responses=True)

# Fallback in-memory cache
fallback_cache = {}

try:
    # Set maxmemory to 100MB
    redis_client.config_set('maxmemory', '100mb')
    # Set eviction policy to allkeys-lru
    redis_client.config_set('maxmemory-policy', 'allkeys-lru')
except ConnectionError:
    print("Redis connection failed. Using in-memory cache as fallback.")

def get_cached(key):
    # Try to get cached response from Redis
    try:
        cached_response = redis_client.get(key)
        if cached_response:
            return jsonify(json.loads(cached_response)), 200
    except ConnectionError:
        # Fallback to in-memory cache
        cached_response = fallback_cache.get(key)
        if cached_response:
            return jsonify(cached_response), 200

def save_cache(key):

    # Cache the response in Redis
    try:
        redis_client.set(key, json.dumps(response_data))
    except ConnectionError:
        # Fallback to in-memory cache
        fallback_cache[key] = response_data