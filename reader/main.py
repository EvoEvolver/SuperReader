import os

import dotenv
import litellm
import mllm
from flask import Flask, request, jsonify

from fibers.gui.renderer import Renderer
from forest.tree import push_tree_data
from reader.build_html_tree import build_html_tree
from reader.nature_paper_to_tree import run_nature_paper_to_tree

dotenv.load_dotenv()
app = Flask(__name__)
mllm.config.default_models.expensive = "gpt-4o"
api_key = os.environ["OPENAI_API_KEY"]
forest_host = os.environ["FOREST_HOST"]
admin_token = os.environ["FOREST_ADMIN_TOKEN"]
litellm.openai_key = api_key


@app.route('/generate_from_nature', methods=['POST'])
def generate_from_nature():
    req = request.get_json()

    link = req["paper_url"]
    html_source = req["html_source"]

    # Generate cache key
    # link_sha1 = "v0.2" + hashlib.sha1(link.encode()).hexdigest()

    # Process the request
    doc = run_nature_paper_to_tree(html_source, link)
    tree_data = Renderer().render_to_json(doc)
    tree_id = push_tree_data(tree_data, forest_host)

    response_data = {
        "tree_url": f"{forest_host}/?id={tree_id}"
    }
    return jsonify(response_data), 200


@app.route('/generate_from_html', methods=['POST'])
def generate_from_html():
    req = request.get_json()
    html_source = req["html_source"]
    doc = build_html_tree(html_source)
    tree_data = Renderer().render_to_json(doc)
    tree_id = push_tree_data(tree_data, forest_host)
    response_data = {
        "tree_url": f"{forest_host}?id={tree_id}"
    }
    return jsonify(response_data), 200


if __name__ == '__main__':
    app.run(host='localhost', port=8080, debug=False)
