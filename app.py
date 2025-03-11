import os
import litellm
import mllm
import requests
import streamlit as st
import openai
import hashlib
from fibers.gui.forest_connector.forest_connector import send_tree_to_backend
from fibers.gui.renderer import Renderer
from reader.nature_paper_to_tree import run_nature_paper_to_tree

reader_host = os.environ.get("READER_HOST", "http://0.0.0.0:29999")
reader_port = 29999



def check_openai_key(api_key: str) -> bool:
    openai.api_key = api_key
    try:
        openai.models.list()
        return True
    except Exception as e:
        return False

def get_current_keys():
    # getTreeList
    url = f'http://0.0.0.0:{reader_port}/api/getTreeList'
    response = requests.get(url)
    return response.json()

def try_redirect_to_tree(link):
    link_sha1 = hashlib.sha1(link.encode()).hexdigest()
    current_keys = get_current_keys()
    if link_sha1 in current_keys:
        tree_link = f"{reader_host}/?id={link_sha1}"
        st.link_button("Open the tree", tree_link)
        st.stop()

link_url = st.query_params.get("link", "")
if link_url:
    try_redirect_to_tree(link_url)

def run(link, api_key):
    mllm.config.default_models.expensive = "gpt-4o"
    litellm.openai_key = api_key
    doc = run_nature_paper_to_tree(link)
    link_sha1 = hashlib.sha1(link.encode()).hexdigest()
    doc.node_id = link_sha1
    current_keys = get_current_keys()
    tree_data = Renderer().render_to_json(doc)
    send_tree_to_backend("0.0.0.0", reader_port, tree_data, doc.node_id)
    return doc.node_id

st.session_state["links"] = {}

st.write("""

# Tree Reader

Currently, the link to the article must be the HTML page of a Springer Nature article.

For example, you can use the following link:

https://link.springer.com/article/10.1007/s10462-024-10740-3
"""
)
if "OPENAI_API_KEY" not in os.environ:
    api_key = st.text_input("OpenAI API key")
else:
    api_key = os.environ["OPENAI_API_KEY"]

link = st.text_input("Link to the article", value=link_url)
button = st.button("Run")

if button:
    if not api_key:
        st.write("Please provide OpenAI API key")
    else:
        if not check_openai_key(api_key):
            st.write("Invalid OpenAI API key")
            st.stop()
        host = "0.0.0.0"
        node_id = run(link, api_key)
        st.write("Running...")
        st.write("Done!")
        tree_link = f"{reader_host}/?id={node_id}"
        st.link_button("Open the tree", tree_link)
        st.session_state["links"][link] = tree_link



if len(st.session_state["links"]) > 0:
    st.write("""
    ## Generated trees
    """)
    for link, tree_link in st.session_state["links"].items():
        st.link_button(link, tree_link)