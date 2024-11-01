from fibers.tree import Attr, Node
import html


class Reference(Attr):
    def __init__(self, node: Node):
        super().__init__(node)
        self.contents = []

    def render(self, rendered):
        contents = Reference.get(self.node).contents

        # del rendered.tabs["contents"]
        rendered.tools[0]["reference"] = "<br/>".join(contents)


def set_reference_obj(node: Node, contents: list[str]):
    ref_data = Reference(node)
    ref_data.contents = contents
