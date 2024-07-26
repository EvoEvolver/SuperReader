from __future__ import annotations

import html

from mllm import Chat

from fibers.tree import Node
from reader.summary import Summary

from typing import TYPE_CHECKING

from fibers.tree.node_attr import Attr

if TYPE_CHECKING:
    from fibers.tree import Node

high_quality_sparse = False

class Relevant(Attr):
    def __init__(self, node: Node):
        super().__init__(node)
        self.relevant = []

    def render(self, rendered):
        contents = [html.escape(str(Relevant.get(self.node).relevant))]
        rendered.tabs["relevant"] = "<br/>".join(contents)


def caselaw_sparse(child: Node):
    def expand_contents(node: Node) -> str:
        if len(node.children()) == 0:
            return node.content
        content = ""
        for e in node.children():
            content += expand_contents(e)
        return content

    keypoints_nodes, keypoints_prompt = get_key_points(child, expand_contents)

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
        res = chat.complete(expensive=high_quality_sparse, cache=True, parse="dict")['relevant']
        print(f"{c.get_attr(Summary).content}\n{res}\n\n")
        relevant = [keypoints_nodes[i] for i in res]
        Relevant.get(c).relevant = relevant
        keypoints_nodes[res[0]].add_child(c)
    child._children = []
    for c in keypoints_nodes:
        if len(c.children()) > 0:
            child.add_child(c)
    return True


def get_key_points(child, expand_contents, high_quality=False):
    chat = Chat()
    promt = f"""
        Providing a chapter of a case law, please summarize 3 to 7 keypoints, each keypoint no more than 50 words, and each keypoint with a title, each title no more than 7 words.Please ensure that the keypoints you summarize are arranged in logical order. Return as JSON format:
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
    keypoints = chat.complete(expensive=high_quality_sparse, cache=True, parse="dict")['keypoints']
    print("keypoints:", keypoints)
    keypoints_prompt = ""
    keypoints_nodes = []
    for i, keypoint in enumerate(keypoints):
        keypoints_prompt += f"id:{i},{keypoint}\n"
        node = Node(keypoint['title'], keypoint['keypoint'])
        Summary.get(node).content = keypoint['keypoint']
        keypoints_nodes.append(node)
    return keypoints_nodes, keypoints_prompt
