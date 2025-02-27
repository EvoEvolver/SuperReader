import os

from fibers.gui.forest_connector.forest_connector import send_tree_to_backend
from fibers.gui.renderer import Renderer

from fibers.tree.node import Node

reader_port = 29999


if __name__ == '__main__':
    node = Node("123")
    send_tree_to_backend("0.0.0.0", reader_port, Renderer().render_to_json(node), node.node_id)