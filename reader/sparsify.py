from __future__ import annotations

import html

from mllm import Chat

from fibers.tree import Node
from reader.summary import Summary, generate_summary_for_node

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
        for i, e in enumerate(node.children()):
            content += f"\nsegment id:{i}\n" + expand_contents(e)
        return content

    fragments = get_break_points(child, expand_contents)
    last_id = 0
    for node, id in fragments:
        print(node.title, id)
        node._children = child.children()[last_id:id+1]
        last_id = id+1
        generate_summary_for_node(node)
    child._children = []
    for node, _ in fragments:
        child.add_child(node)
    # for c in child.children():
    #     chat = Chat()
    #     chat += f"""Providing a segment in a chapter of case law and the keypoints in that chapter, please match this segment with the relevant keypoint, and put the most relevant keypoint at top (don't rank all the keypoints, only choose a few amount all keypoints and then rank them).
    #     Return as JSON format.
    #     Example of return format:
    #     {{
    #     "relevant":[id of the most relevant keypoint, id of the second relevant keypoint, ... ]
    # }}
    #     Segment:
    #     {c.get_attr(Summary).content}
    #     Keypoints:
    #     {keypoints_prompt}
    #     """
    #     res = chat.complete(expensive=high_quality_sparse, cache=True, parse="dict")['relevant']
    #     print(f"{c.get_attr(Summary).content}\n{res}\n\n")
    #     relevant = [keypoints_nodes[i] for i in res]
    #     Relevant.get(c).relevant = relevant
    #     keypoints_nodes[res[0]].add_child(c)
    # child._children = []
    # for c in keypoints_nodes:
    #     if len(c.children()) > 0:
    #         child.add_child(c)
    return True


def get_break_points(child, expand_contents):
    chat = Chat()
    promt = f"""
        Providing a chapter of a case law, please find 3 to 7 break points to give a more clearly logic flow, Make sure each fragment have at least two segment. Then give a title (< 7 words) and a summary (< 50 words) for the fragment. Return as JSON format:
        Example of return format:
        {{
            "breakpoints":[
            {{
            "id":  the id of the last segment in the fragment from by break points
            "title":  example text
             "summary": example text
            }}, ... 
            ]
        }} 
        note that the last "id" in the list will be the id of the last segment in the chapter.

        The following is the segments of this chapter:
        {expand_contents(child)}
        """
    chat += promt
    keypoints = chat.complete(expensive=high_quality_sparse, cache=True, parse="dict")['breakpoints']
    print("keypoints:", keypoints)
    fragments = []
    for i, fragment in enumerate(keypoints):
        node = Node(fragment['title'], "")
        Summary.get(node).content = fragment['summary']
        fragments.append((node, fragment['id']))

    return fragments
