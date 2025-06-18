from mllm import Chat

from fibers.tree import Node
from fibers.utils.mapping import node_map_with_dependency
from reader.build_summary import generate_summary_for_leaf_node, \
    generate_summary_for_section_node
from reader.html_to_raw_tree import html_to_tree
from reader.summary import Summary


def generate_summary_for_node(node: Node) -> bool:
    if len(node.children) == 0:
        generate_summary_for_leaf_node(node)
    elif len(node.children) > 0:  # Section/ Subsection
        for e in node.children:
            if Summary not in e.attrs:
                return False
        generate_summary_for_section_node(node)
    else:
        if Summary not in node.attrs:
            Summary.get(node).content = None
    return True


def build_html_tree(html_source):
    doc, soup = html_to_tree(html_source)
    doc = doc.first_child()
    doc.parent = None

    subsections = [node.title for node in doc.children]
    subsection_nodes = [node for node in doc.children]

    prompt = """
You are required to reconstruct the nested section structure of the document based on the following titles of subsections:
""" + f"{subsections}" + """
You must reconstruct the tree structure based on their titles, ensuring that the hierarchy is maintained.
Notice that you must not change the order of the subsections, and you must not add any additional information.
You are required to output a JSON object that represents the tree structure of the document.
The JSON object should have the following format:
```json
{
    "title": "Document Title",
    "children": [
        {
            "title": "Subsection Title 1",
            "children": []
        },
        {
            "title": "Subsection Title 2",
            "children": []
        }
    ]
}
```
"""
    chat = Chat(dedent=True)
    chat += prompt
    res = chat.complete(parse="dict", cache=True, expensive=True)
    doc_root = Node()

    def attach_nodes(doc_node, dict_node, i_section):
        node = subsection_nodes[i_section]
        node.change_parent(doc_node)
        i_section += 1
        dict_node["node"] = node
        if "children" in dict_node:
            for child in dict_node["children"]:
                i_section = attach_nodes(node, child, i_section)
        return i_section

    # Insert this after getting the res dictionary from chat.complete()
    attach_nodes(doc_root, res, 0)

    for node in doc_root.iter_subtree_with_dfs():
        if len(node.children) == 0:
            continue
        for i, child in enumerate(node.children):
            if i + 1 == len(node.children):
                continue
            if child.title == "" and node.children[i + 1].title == "":
                if len(node.children[i].content) < 5000:
                    node.children[i + 1].content = node.children[i].content + "<br/>" + \
                                                   node.children[
                                                       i + 1].content
                    node.children[i].content = ""

    for node in list(doc_root.iter_subtree_with_dfs()):
        if node.title == "" and node.content == "" and len(node.children) == 0:
            node.remove_self()

    for node in list(doc_root.iter_subtree_with_dfs()):
        if len(node.children) == 1:
            if len(node.first_child().children) == 0:
                node.content = node.first_child().content
                node.first_child().remove_self()

    node_map_with_dependency(doc_root.iter_subtree_with_bfs(),
                             generate_summary_for_node,
                             n_workers=20)

    return doc_root
