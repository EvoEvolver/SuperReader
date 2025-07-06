from __future__ import annotations
from tree import Attr, Node
from reader.nature_paper_to_tree import PaperNode


class Reference(Attr):
    def __init__(self, node: Node):
        super().__init__(node)
        self.contents = []

    def render(self, rendered):
        ...


def set_reference_obj(node: Node, contents: list[str]):
    ref_data = Reference(node)
    ref_data.contents = contents


class RelatedFigures(Attr):
    def __init__(self, node: Node):
        super().__init__(node)
        self.figures = []

    def render(self, rendered):
        rendered.tools[0]["figures"] = "<br/>".join(self.figures)

def construct_related_figures(root: PaperNode):
    for node in root.children:
        if "section" in node._label:
            construct_related_figures(node)
        elif "figure" in node._label:
            RelatedFigures.get(root).figures.append(node.content)
    for node in root.children:
        if "section" in node._label:
            RelatedFigures.get(root).figures += RelatedFigures.get(node).figures

