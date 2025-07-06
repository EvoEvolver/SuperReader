from mllm import Chat
from tenacity import retry, wait_fixed, stop_after_attempt

from tree import Node
from tree.helper import node_map_with_dependency
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


small_node_limit = 1000


def build_html_tree(html_source):
    doc, soup = html_to_tree(html_source)
    doc = doc.first_child()
    doc.parent = None
    doc_root = build_hierarchical_tree_iteratively(list(doc.children))

    for node in doc_root.iter_subtree_with_dfs():
        if len(node.children) == 0:
            continue
        for i, child in enumerate(node.children):
            if i + 1 == len(node.children):
                continue
            if child.title == "" and node.children[i + 1].title == "":
                if len(node.children[i].content) < small_node_limit:
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


# We use @retry on the function that makes the actual API call
@retry(stop=stop_after_attempt(3), wait=wait_fixed(2))
def get_child_titles_from_llm(potential_children):
    """
    Calls the language model to get the direct children for a parent.
    """
    candidate_titles = "\n".join(
        ['"' + node.title + '"' for node in potential_children])
    prompt = f"""
The following is a list of all the headers in a section of an article.
The headers are listed by their order to appear in the article.
The headers may from sections of different level. However, this information is missing in the list and you are required to reconstruct it. You mission now is to select the headers of the top level.
If there is index in the header, you should respect them.
<headers>
{candidate_titles}
</headers>
What are the top-level headers of the section?
Return a JSON dict keys: 
"analysis": string for an analysis of who are the top headers.
"top_headers": string[] for the headers.
"""
    # The user's original code used `chat.add` and `chat.complete`.
    # Emulating a stateless call for clarity in recursion.
    # You may need to adjust this based on your `apyll` library usage.
    response = Chat(prompt).complete(cache=False, parse="dict", expensive=True)
    section_titles = response["top_headers"]
    valid_titles = [node.title for node in potential_children]
    for title in section_titles:
        if title not in valid_titles:
            raise RuntimeError(f"Invalid title: {title}")
    return section_titles


def find_and_attach_children(parent_node, potential_children):
    """
    Recursively finds and attaches child nodes to a parent.

    Args:
        parent_node (Node): The node to which children will be attached.
        potential_children (list): A list of Node objects that are candidates
                                   to be children of the parent_node.
    """
    if not potential_children:
        return  # Base case: no more candidates to process for this parent.


    # 1. Identify direct children using the LLM
    direct_child_titles = get_child_titles_from_llm(potential_children)

    if not direct_child_titles:
        return  # No children found for this parent.

    # 2. Map titles back to actual Node objects and record their original indices
    child_nodes_with_indices = []
    for i, node in enumerate(potential_children):
        if node.title in direct_child_titles:
            child_nodes_with_indices.append({'node': node, 'index': i})

    # 3. Attach children and recurse for each child
    for i, child_info in enumerate(child_nodes_with_indices):
        child_node: Node = child_info['node']
        original_index = child_info['index']

        # Attach the found child to its parent
        child_node.change_parent(parent_node)

        # Determine the scope of potential grandchildren for this new child.
        # These are the nodes between this child and the next sibling.
        start_scope = original_index + 1
        end_scope = None

        # If there is a next sibling, the scope ends before it.
        if i + 1 < len(child_nodes_with_indices):
            end_scope = child_nodes_with_indices[i + 1]['index']

        # Get the list of potential grandchildren
        grandchildren_candidates = potential_children[start_scope:end_scope]

        # 🚀 RECURSIVE CALL
        # Now, do the same process for the new child and its potential children.
        if grandchildren_candidates:
            find_and_attach_children(child_node, grandchildren_candidates)


# --- Main Execution Logic ---

def build_hierarchical_tree_iteratively(all_nodes):
    """
    Builds a full hierarchical tree from a flat list of nodes.
    """
    document_root = Node(title="Document")
    find_and_attach_children(document_root, all_nodes)
    return document_root


if __name__ == '__main__':
    simulated_nodes = [
        Node(title="Introduction"),
        Node(title="Background"),
        Node(title="Methods"),
        Node(title="Data Collection"),
        Node(title="Data Analysis"),
        Node(title="Results"),
        Node(title="Conclusion")
    ]
    doc = build_hierarchical_tree_iteratively(simulated_nodes)
    print(doc)
