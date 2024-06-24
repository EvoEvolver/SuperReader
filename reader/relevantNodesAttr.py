from __future__ import annotations
import html
from typing import TYPE_CHECKING, Any

from fibers.tree.node_attr import Attr

if TYPE_CHECKING:
    from fibers.tree import Node


class Relevant(Attr):
    def __init__(self, node: Node):
        super().__init__(node)
        self.relevant = []



def set_relevant_obj(node: Node, relevant: list[Node]):
    if not node.has_attr(Relevant):
        relevant_obj = Relevant(node)
        relevant_obj.relevant = relevant[:]
    else:
        node.get_attr(Relevant).relevant = relevant


def get_type(node: Node) -> str:
    return "relevant"


def get_docs(node: Node):
    raise NotImplementedError


def get_relevant(node: Node) -> list[Node]:
    return node.get_attr(Relevant).relevant[:]
