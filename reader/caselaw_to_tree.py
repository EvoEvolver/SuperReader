import os
import re
from functools import partial

from fibers.data_loader.html_to_tree import url_to_tree
from fibers.utils.mapping import node_map_with_dependency
from reader.summary import *
from mllm import Chat, debug, caching
from fibers.tree import Node


def is_first_level(node: Node) -> bool:
    first_level = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"]
    return any(s in node.title[:5] for s in first_level)


def is_second_level(node: Node) -> bool:
    second_level = ["A", "B", "C", "D", "E", "F", "G", "H", "*"]
    return any(s in node.title[:1] for s in second_level)


def is_third_level(node: Node) -> bool:
    third_level = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]
    return any(s in node.title[:2] for s in third_level)


def generate_summary_for_node(node: Node) -> bool:
    if 'Segment' in node.title:  # Paragraph
        chat = Chat()
        chat += f"""Providing a paragraph of a case law, write a summary about this paragraph. The summary should be a shortened version of the content of the it. And make a keypoint for no more than 10 words which could use for a Table of Contents. Return in JSON format with tag "summary" and tag "keypoint".
    <Paragraph>
    {node.content}
    </Paragraph>
        """
        try:
            result = chat.complete(expensive=False, parse="dict", cache=True)
            print("paragraph:", result)
            set_summary_obj(node, result['summary'])
            node.title = f"{node.title}: {result['keypoint']}"
        except Exception as e:
            set_summary_obj(node, "Failed to generate summary")
    elif is_first_level(node) or is_second_level(node) or is_third_level(node):  # Subsection
        chat = Chat()
        for e in node.children():
            if Summary not in e.attrs:
                return False
        chat += f"""
        Providing the summary of each paragraph of a case law in a section. Return the summary (About 100 words) of this section in JSON format with the tag "summary":
    <Paragraphs>
    {[get_summary(e) for e in node.children() if Summary in e.attrs and get_summary(e) != "No summary"]}
    </Paragraphs>
        """
        try:
            result = chat.complete(expensive=False, parse="dict", cache=True)
            set_summary_obj(node, result['summary'])
        except Exception as e:
            set_summary_obj(node, "Failed to generate summary")
    else:
        if Summary not in node.attrs:
            set_summary_obj(node, "No summary")
    return True


if __name__ == "__main__":
    os.environ["OPENAI_API_KEY"] = "sk-proj-yswCDVDgrwrvOvgWWZgbT3BlbkFJXgPdF8oQ6Y1qc70ZFPrq"
    # doc = url_to_tree("https://scholar.google.com/scholar_case?case=6657439937507584902&q=trump&hl=en&as_sdt=2006")
    doc = url_to_tree(
        "https://scholar.google.com/scholar_case?case=16062632215534775045&q=trump+v+hawaii&hl=en&as_sdt=2006")
    doc = doc.children()[0]

    last_first_level = doc
    last_second_level = doc
    num = 1
    for child in list(doc.children()):
        child.title = f"{child.title} ({num})"
        num += 1
        if is_first_level(child):
            last_first_level = child
        elif is_second_level(child):
            child.new_parent(last_first_level)
            last_second_level = child
        elif is_third_level(child):
            child.new_parent(last_second_level)

    node_map_with_dependency(doc.iter_subtree_with_bfs(), partial(generate_summary_for_node),
                             n_workers=20)

    doc.display()
