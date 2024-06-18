import os

from fibers.data_loader.html_to_tree import url_to_tree
from reader.summary import *
from mllm import Chat, debug, caching
from fibers.tree import Node


def get_summary(chat: Chat, node: Node) -> str:
    def expandContent(node: Node) -> str:
        if node.content:
            return node.content
        cache = ""
        for child in node.children():
            cache += expandContent(child)
        return cache
    chat += f"""
    Summarize the given chapter of case law into both a detailed text summary and a list of key points. Provide the results in the following JSON format:
{{
  "text_summary": "Detailed text summary goes here.",
  "key_points": [
    "Key point 1",
    "Key point 2",
    "Key point 3",
    ...
  ]
}}
Include all relevant legal principles, major court rulings, and any significant implications the case law may have. Ensure the summary is clear and concise.
The following is the chapter:
{expandContent(node)}"""
    result = chat.complete(expensive=True,parse="dict")
    print(result)
    return ""

if __name__ == "__main__":
    os.environ["OPENAI_API_KEY"] = "sk-proj-yswCDVDgrwrvOvgWWZgbT3BlbkFJXgPdF8oQ6Y1qc70ZFPrq"
    doc = url_to_tree("https://scholar.google.com/scholar_case?case=6657439937507584902&q=trump&hl=en&as_sdt=2006")
    doc = doc.children()[0]

    first_level = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"]
    second_level = ["A", "B", "C", "D", "E", "F", "G", "H"]
    third_level = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]

    last_first_level = doc
    for child in list(doc.children()):
        if child.title in first_level:
            last_first_level = child
        if child.title in second_level+third_level:
            child.new_parent(last_first_level)
    chat = Chat()
    for c in doc.iter_subtree_with_bfs():
        if c.title in first_level:
            set_summary_obj(c, get_summary(chat, c))



    doc.display()
