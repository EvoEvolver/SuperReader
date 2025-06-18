from markdownify import markdownify
from mllm import Chat

from fibers.tree import Node
from reader.nature_paper_to_tree import PaperNode
from reader.summary import Summary
high_quality_arxiv_summary = False


def generate_summary_of_abstract(root: Node):
    for node in root.iter_subtree_with_bfs():
        if node.title == "Abstract":
            chat = Chat()
            chat += f"""This is an Abstract of a scientific paper, please write a 80 words summary about what this paper about from the summary, and a 20 words brief describe about the content. For both the summary and the brief describe, please start directly with meaningful content and DON'T add meaning less leading words like 'Thi paper tells'/'This paragraph tells'. return the summary in JSON format with the tag "summary", and the brief describe with tag "brief".
                <Abstract>
                {markdownify(node.content)}
                </Abstract>
                """
            abstract_summary = \
                chat.complete(expensive=high_quality_arxiv_summary, parse="dict",
                              cache=True)[
                    "summary"]
            short_summary = \
                chat.complete(expensive=high_quality_arxiv_summary, parse="dict",
                              cache=True)["brief"]

            return abstract_summary, short_summary
        return None
    return None


def generate_summary_for_node(node: Node) -> bool:
    if node.get_label() in ["figure", "table"]:
        Summary.get(node).content = None
        return True

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


def generate_summary_for_section_node(node):
    content_list = []
    for e in node.children:
        if Summary in e.attrs and Summary.get(e).has_summary():
            if Summary.get(e).short_content != "":
                content_list.append("# " + Summary.get(e).short_content)
            else:
                content_list.append("# Subsection")
            content_list.append(Summary.get(e).get_summary_for_resummary())
            content_list.append("---")

    contents = "\n".join(content_list)

    chat = Chat(dedent=True)
    chat += f"""
    Please summarize the content of the section.
    <Contents>
    {contents}
    </Contents>
    <Requirement>
    You are required to output a summary of the section contents in the format of 2~7 key points. The key points should not be more than 70 words in total. The key points should summary the original content comprehensively.
    Return your summary in with a JSON with a single key "points", whose value is a list with 2~7 JSON objects with the following keys:
    "point" (str): A key point of the section contents. The key point should be a complete sentence stating an important facts. You don't need to start with "The section discusses" or similar phrases.
    </Requirement>
        """
    try:
        result = chat.complete(expensive=False, parse="dict",
                               cache=True)
        Summary.get(node).summaries_with_evidence = result["points"]

        node_title_summary = []
        for child in node.children:
            node_title_summary.append(f"<strong>{child.title}</strong>")
            if Summary.get(child).short_content:
                node_title_summary.append(f"{Summary.get(child).short_content}")

        node_content = '\n\n<br/>'.join(node_title_summary)
        node.content = node_content

    except Exception as e:
        Summary.get(node).content = "Failed to generate summary"

    chat = Chat(dedent=True)
    chat += f"""Please summarize the content of the section.
    <Contents>
    {contents}
    </Contents>
    <Requirement>
    You are required to output a short summary for the section. The title should be a complete sentence that help people to understand the content of the paragraph. The summary should not be more than 20 words in total.
    Return your summary in with a JSON with a single key "summary", whose value is a string.
    </Requirement>
    """
    result = chat.complete(expensive=False, parse="dict",
                           cache=True)
    Summary.get(node).short_content = result["summary"]


def generate_summary_for_leaf_node(node):
    chat = Chat(dedent=True)
    chat += f"""Please summarize the paragraph . 
    <Paragraph>
    {Summary.get(node).get_content_for_summary()}
    </Paragraph>
    <Requirement>
    You are required to output a summary of the paragraph in the format of 2~7 key points. The key points should not be more than 70 words in total. The key points should summary the original content comprehensively.
    Return your summary in with a JSON with a single key "points", whose value is a list with 2~7 JSON objects with the following key:
    "point" (str): A key point of the paragraph. The key point should be a complete sentence stating an important facts. You don't need to start with "The paragraph discusses" or similar phrases.
    </Requirement>
    """
    try:
        result = chat.complete(expensive=False, parse="dict", cache=True)
        Summary.get(node).summaries_with_evidence = result["points"]
        new_children = PaperNode(None, label="paragraph")
        node.add_child(new_children)
        new_children.content = node.content
        Summary.get(new_children)
    except Exception as e:
        Summary.get(node).content = "Failed to generate summary"

    if not node.title:
        chat = Chat(dedent=True)
        chat += f"""Here is an abstract of a scientific paper and a specific paragraph from the same paper.
        <Paragraph>
        {node.content}
        </Paragraph>
        <Requirement>
        You are required to output a title for the paragraph. The title should be a complete sentence that help people to understand the content of the paragraph. The title should not be more than 20 words in total.
        Return your title in with a JSON with a single key "title", whose value is a string.
        </Requirement>
        """
        result = chat.complete(expensive=False, parse="dict",
                               cache=True)
        node.title = f"""¶ {result["title"]}"""
