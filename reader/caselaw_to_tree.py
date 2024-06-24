import os
import re
from functools import partial

from fibers.data_loader.html_to_tree import url_to_tree
from fibers.utils.mapping import node_map_with_dependency
from reader.summary import *
from reader.relevantNodesAttr import *
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
        chat += f"""Providing a paragraph of a case law, write a summary about this paragraph (no more than 100 words). The summary should be a shortened version of the content of the it. And make a keypoint for no more than 10 words which could use for a Table of Contents. Return in JSON format with tag "summary" and tag "keypoint".
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


def caselaw_sparse(node: Node):
    def expand_contents(node: Node) -> str:
        if len(node.children()) == 0:
            return node.content
        content = ""
        for e in node.children():
            content += expand_contents(e)
        return content

    for child in reversed(list(node.iter_subtree_with_bfs())):
        if len(child.children()) < 7:  # Only sparse the tree when more than 5 children
            continue
        if any(len(c.children()) > 0 for c in child.children()):
            continue
        chat = Chat()
        promt = f"""
        Providing a chapter of a case law, please summarize 3 to 7 keypoints, each keypoint no more than 50 words, and each keypoint with a title, each title no more than 7 words. Return as JSON format:
        Example of return format:
        {{
            "keypoints":[
            {{"title":  example text
             "keypoint": example text
            }}, ... 
            ]
        }} 
        
        The following is the content of this chapter:
        {expand_contents(child)}
        """
        chat += promt
        keypoints = chat.complete(cache=True, parse="dict")['keypoints']
        print("keypoints:", keypoints)
        keypoints_prompt = ""
        keypoints_nodes = []
        for i, keypoint in enumerate(keypoints):
            keypoints_prompt += f"id:{i},{keypoint}\n"
            node = Node(keypoint['title'], keypoint['keypoint'])
            set_summary_obj(node, keypoint['keypoint'])
            keypoints_nodes.append(node)

        for c in child.children():
            chat = Chat()
            chat += f"""Providing a segment in a chapter of case law and the keypoints in that chapter, please match this segment with the relevant keypoint, and put the most relevant keypoint at top (don't rank all the keypoints, only choose a few amount all keypoints and then rank them).  
            Return as JSON format.
            Example of return format:
            {{
            "relevant":[id of the most relevant keypoint, id of the second relevant keypoint, ... ]
        }}
            Segment:
            {c.get_attr(Summary).content}
            Keypoints:
            {keypoints_prompt}
            """
            res = chat.complete(cache=True, parse="dict")['relevant']
            print(f"{c.get_attr(Summary).content}\n{res}\n\n")
            set_relevant_obj(c, [keypoints_nodes[i] for i in res])
            keypoints_nodes[res[0]].add_child(c)
        child._children = keypoints_nodes[:]
        for c in keypoints_nodes:
            if len(c.children()) > 0:
                child.add_child(c)


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

    caselaw_sparse(doc)

    doc.display(dev_mode=True)
