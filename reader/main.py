import json
import os

import dotenv
import litellm
import mllm
import requests
from flask import Flask, request, jsonify
from werkzeug.middleware.proxy_fix import ProxyFix

import forest
from fibers.gui.renderer import Renderer
from reader.build_html_tree import build_html_tree
from reader.nature_paper_to_tree import run_nature_paper_to_tree

# Load environment variables
dotenv.load_dotenv()

# Initialize Flask app
app = Flask(__name__)
# Handle X-Forwarded-* headers from reverse proxies
app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1, x_host=1)

# Configure MLLM and LiteLLM
mllm.config.default_models.expensive = "gpt-4o"
api_key = os.environ.get("OPENAI_API_KEY")
forest_host = os.environ.get("FOREST_HOST", "http://localhost:29999")
admin_token = os.environ.get("FOREST_ADMIN_TOKEN")

if not all([api_key, forest_host, admin_token]):
    raise ValueError("Required environment variables are not set")

litellm.openai_key = api_key


# Error handling
@app.errorhandler(Exception)
def handle_error(error):
    return jsonify({
        "error": str(error),
        "status": "error"
    }), 500


@app.route('/generate_from_nature', methods=['POST'])
def generate_from_nature():
    try:
        req = request.get_json()
        if not req:
            return jsonify({"error": "No JSON data provided"}), 400

        link = req.get("paper_url")
        html_source = req.get("html_source")

        if not all([link, html_source]):
            return jsonify({"error": "Missing required fields"}), 400

        doc = run_nature_paper_to_tree(html_source, link)
        tree_data = Renderer().render_to_json(doc)
        tree_id = push_tree_data(tree_data, forest_host, admin_token)

        return jsonify({
            "status": "success",
            "tree_url": f"{forest_host}/?id={tree_id}"
        }), 200
    except Exception as e:
        return jsonify({
            "error": str(e),
            "status": "error"
        }), 500


@app.route('/generate_from_html', methods=['POST'])
def generate_from_html():
    try:
        req = request.get_json()
        if not req:
            return jsonify({"error": "No JSON data provided"}), 400

        html_source = req.get("html_source")
        if not html_source:
            return jsonify({"error": "Missing html_source"}), 400

        doc = build_html_tree(html_source)
        tree_data = Renderer().render_to_json(doc)
        tree_id = push_tree_data(tree_data, forest_host, admin_token)

        return jsonify({
            "status": "success",
            "tree_url": f"{forest_host}?id={tree_id}"
        }), 200
    except Exception as e:
        return jsonify({
            "error": str(e),
            "status": "error"
        }), 500


def push_tree_data(tree_data, host="http://0.0.0.0:29999", token=None):
    url = f'{host}/api/createTree'
    root_id = tree_data["rootId"]
    payload = json.dumps({
        "tree": tree_data,
        "root_id": str(root_id),
    })
    headers = {
        'Content-Type': 'application/json'
    }
    if token is not None:
        headers['Authorization'] = f'Bearer {token}'
    response = requests.request("PUT", url, headers=headers, data=payload)
    response.raise_for_status()
    # get tree_id from response
    if response.status_code == 200:
        response_data = response.json()
        if 'tree_id' in response_data:
            tree_id = response_data['tree_id']
            print(f"Created tree to {host}/?id={tree_id}")
            return tree_id
        else:
            print("Tree updated but no tree_id returned.")
    else:
        print(f"Failed to update tree: {response.status_code} - {response.text}")


if __name__ == '__main__':
    # In production, use a proper WSGI server like gunicorn
    app.run(
        host='0.0.0.0',  # Listen on all interfaces
        port=int(os.environ.get("PORT", 8080)),
        debug=False
    )
