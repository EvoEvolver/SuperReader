from fibers.gui.forest_connector.forest_connector import send_tree_to_backend
from fibers.gui.renderer import Renderer

from fibers.tree.node import Node


if __name__ == '__main__':
    node = Node("1234")
    print(Renderer().render_to_json(node))
    host = "0.0.0.0:29999"
    host = "https://page.treer.ai"
    res = send_tree_to_backend(host, Renderer().render_to_json(node), node.node_id)
    print(res)