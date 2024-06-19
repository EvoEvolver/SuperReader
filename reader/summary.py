from __future__ import annotations
import html
from typing import TYPE_CHECKING, Any

from fibers.tree.node_attr import Attr

if TYPE_CHECKING:
    from fibers.tree import Node


class Summary(Attr):
    def __init__(self, node: Node):
        super().__init__(node)
        self.content = ""

    def render(self, rendered):
        contents = [f"""
        <summary/>
        """, html.escape(get_summary(self.node))]

        # del rendered.tabs["contents"]
        rendered.tabs["summary"] = "<br/>".join(contents)


def set_summary_obj(node: Node, summary: str):
    if not node.has_attr(Summary):
        summary_obj = Summary(node)
        summary_obj.content = summary
    else:
        node.get_attr(Summary).content = summary


def get_type(node: Node) -> str:
    return "summary"


def get_docs(node: Node):
    raise NotImplementedError


def get_summary(node: Node) -> str:
    return str(node.get_attr(Summary).content)
