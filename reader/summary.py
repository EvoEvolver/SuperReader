from __future__ import annotations
import html
from typing import TYPE_CHECKING

from mllm import Chat

from fibers.tree.node_attr import Attr
from reader.caselaw_to_tree import is_first_level, is_second_level, is_third_level

if TYPE_CHECKING:
    from fibers.tree import Node

high_quality_summary = False


class Summary(Attr):
    def __init__(self, node: Node):
        super().__init__(node)
        self.content = ""

    def render(self, rendered):

        if len(self.node.content) > 0:
            rendered.tools[0]["summary"] = html.escape(str(self.content))
        else:
            del rendered.tabs["content"]
            rendered.tabs["summary"] = html.escape(str(self.content))


def generate_summary_for_node(node: Node) -> bool:
    if 'Segment' in node.title[:7]:  # Paragraph
        chat = Chat()
        chat += f"""
    Providing a paragraph of a case law, write a summary about the following paragraph
    <Paragraph>
    {node.content}
    </Paragraph>
    Output a JSON with the following keys:
    - "summary" (string):  a summary about 3 sentences. The summary should be a shortened version of the content of the it. 
    - "keypoint" (string): a shorter summary for no more than 10 words which could use for a Table of Contents. 
    """
        try:
            result = chat.complete(expensive=high_quality_summary, parse="dict", cache=True)
            print("paragraph:", result)
            summary = result['summary']
            Summary.get(node).content = summary
            node.title = f"{node.title}: {result['keypoint']}"
        except Exception as e:
            Summary.get(node).content = "Failed to generate summary"
    elif len(node.children()) > 0:  # Subsection
        chat = Chat()
        for e in node.children():
            if Summary not in e.attrs:
                return False
        chat += f"""
        Providing the summary of each paragraph of a case law in a section. Return the summary (About 3 sentences) of this section in JSON format with the tag "summary":
    <Paragraphs>
    {[Summary.get(e).content for e in node.children() if Summary in e.attrs and Summary.get(e).content != "No summary"]}
    </Paragraphs>
        """
        try:
            result = chat.complete(expensive=high_quality_summary, parse="dict", cache=True)
            summary1 = result['summary']
            Summary.get(node).content = summary1
        except Exception as e:
            Summary.get(node).content = "Failed to generate summary"
    else:
        if Summary not in node.attrs:
            Summary.get(node).content = "No summary"
    return True
