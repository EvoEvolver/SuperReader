import re

from bs4 import Tag

from fibers.data_loader.html_to_tree import url_to_tree, SoupInfo
from fibers.tree import Node
from reader.reference import set_reference_obj


def is_first_level(node: Node) -> bool:
    first_level = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"]
    return any(s in node.title[:5] for s in first_level)


def is_second_level(node: Node) -> bool:
    second_level = ["A", "B", "C", "D", "E", "F", "G", "H", "*"]
    return any(s in node.title[:1] for s in second_level)


def is_third_level(node: Node) -> bool:
    third_level = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]
    return any(s in node.title[:2] for s in third_level)


def remove_page_num(root: Node):
    for node in root.iter_subtree_with_dfs():
        soup_attr = SoupInfo.get(node)
        soup = soup_attr.soup
        # remove all the elements whose class is "gsl_pagenum" or "gsl_pagenum2"
        for tag in soup.find_all(class_=lambda x: x and 'gsl_pagenum' in x, recursive=True):
            tag.decompose()
    SoupInfo.soup_to_content(root)


def merge_blockquote(root: Node):
    """
    Merge blockquote into the previous node.
    :param root:
    :return:
    """
    nodes_to_remove = []
    for node in root.iter_subtree_with_dfs():
        soup_attr = SoupInfo.get(node)
        soup = soup_attr.soup
        if soup.blockquote:
            node_index = node.index_in_siblings()
            if node_index == 0:
                continue
            previous_node = node.parent().children()[node_index - 1]
            previous_soup = SoupInfo.get(previous_node).soup
            previous_soup.append(soup.blockquote)
            soup.decompose()
            nodes_to_remove.append(node)
    for node in nodes_to_remove:
        node.remove_self()
    SoupInfo.soup_to_content(root)


def merge_small_segment(root: Node):
    """
    Merge small segment into the previous node.
    :param root:
    :return:
    """
    small_bound = 100
    too_large_bound = 500
    nodes_to_remove = []
    for node in root.iter_subtree_with_dfs():
        if node.has_child():
            continue
        soup_attr = SoupInfo.get(node)
        soup = soup_attr.soup
        if len(soup.text) < small_bound:
            node_index = node.index_in_siblings()
            if node_index == 0:
                continue
            previous_node = node.parent().children()[node_index - 1]
            previous_soup = SoupInfo.get(previous_node).soup
            if len(previous_soup.text) > too_large_bound:
                continue
            previous_soup.append(soup)
            soup.decompose()
            nodes_to_remove.append(node)
    for node in nodes_to_remove:
        node.remove_self()
    SoupInfo.soup_to_content(root)


def get_caselaw_tree(url: str) -> Node:
    doc, soup = url_to_tree(url)
    doc = doc.children()[0]
    last_first_level = doc
    last_second_level = doc
    num = 1
    for child in list(doc.children()):
        num += 1
        if is_first_level(child):
            last_first_level = child
        elif is_second_level(child):
            child.new_parent(last_first_level)
            last_second_level = child
        elif is_third_level(child):
            child.new_parent(last_second_level)
    remove_page_num(doc)
    merge_blockquote(doc)
    merge_small_segment(doc)
    for c in doc.iter_subtree_with_bfs():
        if len(c.children()) == 0:
            html_string = c.content
            pattern = r'.*name="r\[(\d+)\]".*'

            match = re.search(pattern, html_string)
            if match:
                number = match.group(1)
                print(number)
                possible_contents = soup.find_all('a', class_='gsl_hash', recursive=True)
                for t in possible_contents:
                    if isinstance(t, Tag) and t.get('name') == f'[{number}]' and t.parent.name == 'p':
                        print(t.parent)
                        set_reference_obj(c, t.parent.__str__())
    return doc
