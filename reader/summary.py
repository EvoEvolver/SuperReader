from __future__ import annotations

import html
from typing import TYPE_CHECKING

from markdownify import markdownify
from mllm import Chat

from fibers.tree.node_attr import Attr

if TYPE_CHECKING:
    from fibers.tree import Node

high_quality_summary = False


class Summary(Attr):
    def __init__(self, node: Node):
        super().__init__(node)
        self.content = ""
        self.short_content = ""
        self.show_content_as_detail = False
        self.summaries_with_evidence = []

    def has_summary(self):
        if self.content != "" and self.content is not None:
            return True
        if len(self.summaries_with_evidence) > 0:
            return True
        return False

    def get_summary_for_resummary(self):
        if self.content != "":
            return self.content
        if len(self.summaries_with_evidence) > 0:
            summary_to_summary = []
            for point in self.summaries_with_evidence:
                point_summary = f"""- {html.escape(point["point"])}"""
                summary_to_summary.append(point_summary)
            return "\n".join(summary_to_summary)

    def get_summary_for_display(self):
        if self.content != "":
            return self.content
        if len(self.summaries_with_evidence) > 0:
            summary_to_display = ["<ul>"]
            for point in self.summaries_with_evidence:
                display_html = f"""<li>{point["point"]}<Tooltip title="Source: {markdownify(point["evidence"])}"><span>📄</span></Tooltip></li>"""
                summary_to_display.append(display_html)
            summary_to_display.append("</ul>")
            return "".join(summary_to_display)

    def render(self, rendered):
        if self.content is None:
            return
        if len(self.node.content) > 0:
                rendered.tabs["summary"] = self.get_summary_for_display()
                rendered.tools[1]["content"] = str(self.node.content)
                del rendered.tabs["content"]
        else:
            del rendered.tabs["content"]
            rendered.tabs["summary"] = self.get_summary_for_display()
        if self.short_content:
            rendered.data["short_summary"] = self.short_content


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
    elif len(node.children) > 0:  # Subsection
        chat = Chat()
        for e in node.children:
            if Summary not in e.attrs:
                return False
        chat += f"""
        Providing the summary of each paragraph of a case law in a section. Return the summary (About 3 sentences) of this section in JSON format with the tag "summary":
    <Paragraphs>
    {[Summary.get(e).content for e in node.children if Summary in e.attrs and Summary.get(e).content != "No summary"]}
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
