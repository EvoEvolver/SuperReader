from __future__ import annotations
from typing import TYPE_CHECKING

from tree.forest import Rendered

if TYPE_CHECKING:
    from tree import Node


class Attr:
    def __init__(self, node: Node):
        if self.__class__ in node.attrs:
            raise Exception(f"Node {node} already has attr {self.__class__}")
        node.attrs[self.__class__] = self
        self.node: Node = node

    @classmethod
    def get(cls, node: Node):
        return node.get_attr(cls)

    def render(self, rendered: Rendered):
        pass