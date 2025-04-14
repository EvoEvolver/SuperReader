import hashlib
import os

import litellm
import mllm
from flask import Flask, request, jsonify

from fibers.gui.renderer import Renderer
from reader.nature_paper_to_tree import run_nature_paper_to_tree

app = Flask(__name__)

mllm.config.default_models.expensive = "gpt-4o"
api_key = os.environ["OPENAI_API_KEY"]
litellm.openai_key = api_key

@app.route('/generate', methods=['POST'])
def generate():
    # Parse JSON payload from the request
    data = request.get_json()
    if not data:
        return jsonify({"error": "Invalid or missing JSON payload"}), 400

    link = data["url"]
    html_source = data["html_source"]
    doc = run_nature_paper_to_tree(html_source, link)
    link_sha1 = hashlib.sha1(link.encode()).hexdigest()
    doc.node_id = link_sha1
    tree_data = Renderer().render_to_json(doc)

    response_data = {
        "tree_data": tree_data,
        "root_id": doc.node_id
    }

    return jsonify(response_data), 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8081)