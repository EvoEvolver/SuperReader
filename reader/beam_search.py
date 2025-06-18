from typing import List

from mllm import Chat
from mllm.utils import p_map

from fibers.tree import Node
from fibers.utils.prompt_utils import get_node_list_prompt
from reader.summary import Summary


def beam_search(root: Node, requirement: str) -> List[
    Node]:
    node_queue = [root]
    visited_nodes = set()
    matched_nodes_set = set()

    def pick_next_wrapped(node: Node):
        return pick_next(node, requirement)

    while len(node_queue) > 0:
        node_touched = []
        for _, res in p_map(pick_next_wrapped, node_queue):
            matched_nodes, possible_parents = res
            matched_nodes_set.update(matched_nodes)
            node_touched.extend(possible_parents)
            node_touched.extend(matched_nodes)
        node_queue = []
        for node in node_touched:
            if node not in visited_nodes:
                node_queue.append(node)
                visited_nodes.add(node)

    return list(matched_nodes_set)


def pick_next(node: Node, requirement: str) -> (
        List[Node], List[Node]):
    children = list(node.children)
    children_list = children
    if len(children_list) == 0:
        return [], []

    if len(children_list) == 1:
        return [children_list[0]], []
    children_in_prompt =[]

    for i, child in enumerate(children_list):
        title = child.title if child.title+":" else ""
        content = Summary.get(child).get_content_for_summary()
        children_in_prompt.append(f"{i}. {title} {content}")

    children_in_prompt = "\n".join(children_in_prompt)

    prompt = f"""
You are traveling on a tree of knowledge. From the following list, you should pick the children that satisfies the requirement, and the children might be the ancestor of the required node.

Children:
{children_in_prompt}

Requirement:
{requirement}

Format:
Output a JSON dict with key "matched_indices" for a list of indices of the children that satisfies the requirement, and key "parent_indices" for a list of indices that might be the ancestor of the required node.
"""
    chat = Chat(prompt)
    res = chat.complete(parse="dict", cache=True, expensive=True)
    matched_indices = res["matched_indices"] if "matched_indices" in res else []
    parent_indices = res["parent_indices"] if "parent_indices" in res else []
    matched_children = [children_list[i] for i in matched_indices]
    parent_indices = [children_list[i] for i in parent_indices]
    return matched_children, parent_indices


def main(root: Node, question: str):
    matched_children, ancestor_children = pick_next(root,
                                                    question)

if __name__ == '__main__':
    doc_root = None
    question = 'What are the simulations done here?'
    res = beam_search(doc_root.first_child().first_child(), question)

    doc_to_prompt = ""
    for node in res:
        doc_to_prompt += f"{node.title}\n{Summary.get(node).get_content_for_summary()}\n\n"

    prompt = f"""
    You are required to answer the question based on the following document.
    Document:
    {doc_to_prompt}
    Question:
    {question}
    You answer in markdown:
    """
    chat = Chat(dedent=True)
    chat += prompt
    answer = chat.complete(cache=True, expensive=True)
    print("Answer:", answer)