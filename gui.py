import subprocess
import time

import requests
import streamlit as st
import openai

def check_openai_key(api_key: str) -> bool:
    openai.api_key = api_key
    try:
        openai.models.list()
        return True
    except Exception as e:
        return False

def available_port(host="localhost") -> int:
    for i in range(40000, 50000):
        if not check_alive(i, host):
            return i

def check_alive(port: int, host: str) -> bool:
    # send message to host:port/alive
    url = f"http://{host}:{port}/alive"
    try:
        response = requests.get(url)
        return response.status_code == 200 or response.status_code == 404
    except Exception as e:
        return False

def start_new_service(link, api_key, host="localhost"):
    port = available_port(host)
    subprocess.Popen(["python", "web_service.py", link, str(port), api_key])
    for i in range(600):
        if check_alive(port, host):
            return port
        else:
            time.sleep(1)
    raise Exception("Tree service not started in time")

st.session_state["links"] = {}

st.write("""

# Tree Reader

Currently, the link to the article must be the HTML page of a Springer Nature article.

For example, you can use the following link:

https://link.springer.com/article/10.1007/s10462-024-10740-3
"""
)
api_key = st.text_input("OpenAI API key")
link = st.text_input("Link to the article")
button = st.button("Run")

if button:
    if not api_key:
        st.write("Please provide OpenAI API key")
    else:
        if not check_openai_key(api_key):
            st.write("Invalid OpenAI API key")
            st.stop()
        st.write("Running...")
        host = "localhost"
        port = start_new_service(link, api_key)
        st.write("Done!")
        tree_link = f"http://{host}:{port}/"
        st.link_button("Open the tree", tree_link)
        st.session_state["links"][link] = tree_link



if len(st.session_state["links"]) > 0:
    st.write("""
    ## Generated trees
    """)
    for link, tree_link in st.session_state["links"].items():
        st.link_button(link, tree_link)