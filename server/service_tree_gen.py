import hashlib
import os
import json
import litellm
import mllm
from flask import Flask, request, jsonify
from redis import Redis, ConnectionError

from fibers.gui.renderer import Renderer
from reader.nature_paper_to_tree import run_nature_paper_to_tree

app = Flask(__name__)
mllm.config.default_models.expensive = "gpt-4o"
api_key = os.environ["OPENAI_API_KEY"]
litellm.openai_key = api_key

# Initialize Redis client
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

@app.route('/generate', methods=['POST'])
def generate():
    # Parse JSON payload from the request
    data = request.get_json()
    if not data:
        return jsonify({"error": "Invalid or missing JSON payload"}), 400

    link = data["url"]
    html_source = data["html_source"]

    # Generate cache key
    link_sha1 = "v0.1" + hashlib.sha1(link.encode()).hexdigest()

    # Try to get cached response from Redis
    try:
        cached_response = redis_client.get(link_sha1)
        if cached_response:
            return jsonify(json.loads(cached_response)), 200
    except ConnectionError:
        # Fallback to in-memory cache
        cached_response = fallback_cache.get(link_sha1)
        if cached_response:
            return jsonify(cached_response), 200

    # Process the request
    doc = run_nature_paper_to_tree(html_source, link)
    doc.node_id = link_sha1
    tree_data = Renderer().render_to_json(doc)

    response_data = {
        "tree_data": tree_data,
        "root_id": doc.node_id
    }

    # Cache the response in Redis
    try:
        redis_client.set(link_sha1, json.dumps(response_data))
    except ConnectionError:
        # Fallback to in-memory cache
        fallback_cache[link_sha1] = response_data

    return jsonify(response_data), 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8081, debug=False)