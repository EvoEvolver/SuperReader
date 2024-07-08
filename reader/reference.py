from fibers.tree import Attr, Node
import html


class Reference(Attr):
    def __init__(self, node: Node):
        super().__init__(node)
        self.content = ""

    def render(self, rendered):
        contents = Reference.get(self.node).content

        # del rendered.tabs["contents"]
        rendered.tabs["reference"] = f"<br/>{contents}"


def set_reference_obj(node: Node, content: str):
    ref_data = Reference(node)
    ref_data.content = content
