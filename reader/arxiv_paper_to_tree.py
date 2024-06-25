from functools import partial

from mllm.utils import parallel_map

from reader.summary import *
from mllm import Chat
import os
import re
from typing import List

import requests
from bs4 import BeautifulSoup
from bs4 import Tag
from fibers.utils.mapping import node_map_with_dependency

from fibers.tree import Node
from fibers.tree.node_attr import Attr
from reader.summary import Summary

# arxiv_url = "https://arxiv.org/html/2401.11314v2"

arxiv_url = "https://arxiv.org/html/2404.04326v1"


# arxiv_url = "https://arxiv.org/html/2406.07003v1"


class ArxivNode(Node):
    def __init__(self, source: BeautifulSoup | Tag, id: str, label: str, title: str = "", content: str = ""):
        super().__init__(title, content)
        self._label: str = label
        self._id: str = id
        self._html_soup: BeautifulSoup = source

    def get_label(self) -> str:
        return self._label

    def get_id(self) -> str:
        return self._id

    def get_soup(self) -> BeautifulSoup:
        return self._html_soup

    def set_children(self, children: List[Node]):
        self._children = children
        for c in self._children:
            c._parent = self


def replace_math_with_tex(soup: BeautifulSoup):
    for tag in soup.find_all("math", recursive=True):
        if not isinstance(tag, Tag):
            continue
        latex = tag.get("alttext")
        alt_tag = soup.new_tag("TeX")
        if latex is not None:
            alt_tag['src'] = latex
            tag.replace_with(alt_tag)
        else:
            tag.decompose()


def pre_process_html_tree(soup: BeautifulSoup):
    for script in soup(["script", "style"]):
        # remove all javascript and stylesheet code
        script.decompose()


def get_abstract_node(rootSoup: BeautifulSoup) -> ArxivNode:
    source = rootSoup.find('div', class_="ltx_abstract", recursive=True)
    content_wraper = source.find('p', class_='ltx_p')
    return ArxivNode(source, content_wraper.get('id'), "abstract", "Abstract", content_wraper.text)


def get_section_nodes(rootSoup: BeautifulSoup) -> list[ArxivNode]:
    children = []
    for section in rootSoup.find_all('section', class_='ltx_section', recursive=True):
        if not re.match(r'^S\d+$', section['id']):
            continue
        print(f"section: {section['id']}")

        Section = ArxivNode(section, section['id'], "section",
                            section.find_all_next('h2', class_="ltx_title ltx_title_section")[0].text, "")
        build_tree(Section)
        children.append(Section)
        print("----------")
    return children


def get_subsection_nodes(sectionSoup: BeautifulSoup) -> list[ArxivNode]:
    global arxiv_url
    children = []
    index_para = 1
    index_figure = 1
    for i, e in enumerate(sectionSoup.children):

        if not isinstance(e, Tag):
            continue
        class_ = e.get('class')
        print(i, e.name, class_)
        if e.name == 'div' and 'ltx_para' in class_:
            if not re.match(r'^S\d+\.p.$', e['id']):
                continue
            print(f"section: {e['id']}")
            # print(section)
            Paragraph = ArxivNode(e, e['id'], "paragraph",
                                  "paragraph " + str(index_para),
                                  '<!DOCTYPE html><meta content=\"text/html; charset=utf-8\" http-equiv=\"content-type\"/>' + e.__str__())
            children.append(Paragraph)
            index_para += 1
        elif e.name == 'section' and 'ltx_subsection' in class_:
            if not re.match(r'^S\d+\.SS\d+$', e['id']):
                continue
            print(f"section: {e['id']}")
            # print(section)
            SubSection = ArxivNode(e, e['id'], "subsection",
                                   e.find('h3', class_="ltx_title ltx_title_subsection").text, "")
            build_tree(SubSection)
            children.append(SubSection)

            print("----------")
        elif e.name == 'figure':
            image_tags = e.find_all('img', class_='ltx_graphics', recursive=True)
            for image_tag in image_tags:
                if image_tag is not None and isinstance(image_tag, Tag):
                    if 'src' in image_tag.attrs:
                        image_tag['src'] = arxiv_url + '/' + image_tag['src']
                    if 'width' in image_tag.attrs and 'height' in image_tag.attrs:
                        # Make sure the image fit in the window
                        w, h = int(image_tag['width']), int(image_tag['height'])
                        div_max_width = 500
                        if w > div_max_width:
                            image_tag['width'] = str(div_max_width)
                            image_tag['height'] = f"{int(h * (div_max_width / w))}"
                            image_tag['style'] = "object-fit: contain;"

            Figure = ArxivNode(e, e['id'], "figure", "figure " + str(index_figure), e.__str__())
            # Figure = ArxivNode(e, e['id'], "figure", "figure " + str(index_figure), re.sub(r"\"([^\"]+)\.(png|jpg)\"", regrex_str, e.__str__()))
            children.append(Figure)
            index_figure += 1
    return children


def remove_tag(html_str, tag):
    import re

    pattern = rf'<{tag}[^>]*>.*?</{tag}>'
    return re.sub(pattern, '', html_str)


def get_paragraph_nodes(subsectionSoup: BeautifulSoup) -> list[ArxivNode]:
    children = []
    index_para = 1
    index_figure = 1
    for i, e in enumerate(subsectionSoup.children):
        if not isinstance(e, Tag):
            continue
        class_ = e.get('class')
        print(i, e.name, class_)
        if e.name == 'div' and ('ltx_para' in class_ or 'ltx_theorem' in class_):
            # if not re.match(r'^S\d+\.SS\d+\.p.$', e['id']):
            #     continue
            print(f"section: {e['id']}")
            # print(section)
            Paragraph = ArxivNode(e, e['id'], "paragraph",
                                  "paragraph " + str(index_para),
                                  '<!DOCTYPE html><meta content=\"text/html; charset=utf-8\" http-equiv=\"content-type\"/>' + e.__str__())
            children.append(Paragraph)
            index_para += 1

            print("----------")
        elif e.name == 'figure':
            # if not re.match(r'^S\d+\.SS\d+\.F\d+$', e['id']) and not re.match(r'alg\d+', e['id']):
            #     continue
            image_tags = e.find_all('img', class_='ltx_graphics', recursive=True)
            for image_tag in image_tags:
                if image_tag is not None and isinstance(image_tag, Tag):
                    if 'src' in image_tag.attrs:
                        image_tag['src'] = arxiv_url + '/' + image_tag['src']
                    if 'width' in image_tag.attrs and 'height' in image_tag.attrs:
                        # Make sure the image fit in the window
                        w, h = int(image_tag['width']), int(image_tag['height'])
                        div_max_width = 500
                        if w > div_max_width:
                            image_tag['width'] = str(div_max_width)
                            image_tag['height'] = f"{int(h * (div_max_width / w))}"
                            image_tag['style'] = "object-fit: contain;"

            Figure = ArxivNode(e, e['id'], "figure", "figure " + str(index_figure), e.__str__())

            children.append(Figure)
            index_figure += 1

    return children


def build_tree(parent: ArxivNode):
    if parent.get_id() == "root":
        title = parent.get_soup().find('h1', class_="ltx_title ltx_title_document", recursive=True)
        if title is None:
            raise Exception("Can't resolve title")
        title = title.text
        parent.title = title

        author = parent.get_soup().find('div', class_="ltx_authors", recursive=True)
        if author is None:
            print("Can't resolve author")
        else:
            parent.content = author.__str__()

        Abstract = get_abstract_node(parent.get_soup())

        parent.set_children([Abstract] + get_section_nodes(parent.get_soup()))

    elif parent.get_label() == "section":
        parent.set_children(get_subsection_nodes(parent.get_soup()))
    elif parent.get_label() == "subsection":
        parent.set_children(get_paragraph_nodes(parent.get_soup()))
    return


def url_to_tree(url: str) -> ArxivNode:
    global arxiv_url
    arxiv_url = url
    html_source = requests.get(url).text
    # try:
    #     with open("cached_page.html", "r", encoding="utf-8") as f:
    #         html_source = f.read()
    # except FileNotFoundError:
    #     print("Error: Cached HTML file not found.")
    soup = BeautifulSoup(html_source, "html.parser")
    replace_math_with_tex(soup)
    pre_process_html_tree(soup)
    head = ArxivNode(soup, "root", "root", "", "")
    build_tree(head)
    return head


def generate_summary_of_abstract(root: Node):
    for node in root.iter_subtree_with_bfs():
        if node.title == "Abstract":
            chat = Chat()
            chat += f"""This is an Abstract of a scientific paper, please write a 50 words summary about what this paper about from the summary, return the summary in JSON format with the tag "summary"
                <Abstract>
                {node.content}
                </Abstract>
                """
            try:
                abstract = chat.complete(expensive=False, parse="dict", cache=True)["summary"]
                Summary.get(node).content = abstract
                return abstract
            except Exception as e:
                abstract = node.content
            return abstract
        else:
            continue


def generate_summary_for_node(node: ArxivNode, abstract: str) -> bool:
    if 'p' in node.get_id():  # Paragraph
        chat = Chat()
        chat += f"""Providing an abstract of a scientific paper and a specific paragraph from the same paper. Please read both and then summarize the paragraph in the context of the abstract. Make sure the summary for no more than 50 words, and make a keypoint for no more than 10 words which could use for a Table of Contents. Return your summary in JSON format with the tag "summary", the key point with tag "keypoint.
    <Abstract>
    {abstract}
    </Abstract>
    <Paragraph>
    {node.content}
    </Paragraph>
        """
        try:
            result = chat.complete(expensive=False, parse="dict", cache=True)
            print("paragraph:", result)
            summary = result['summary']
            Summary.get(node).content = summary
            node.title = f"{node.title}: {result['keypoint']}"
        except Exception as e:
            Summary.get(node).content = "Failed to generate summary"
    elif re.match(r'^S\d+\.SS\d+$', node.get_id()) or re.match(r'^S\d+$', node.get_id()):  # Subsection
        chat = Chat()
        for e in node.children():
            if Summary not in e.attrs:
                return False
        chat += f"""
        Please summarize the section of a scientific paper. You will be provide the abstract of the paper, and the summary of each paragraph in this subsection. Return the summary (About 100 words) of the subsection in JSON format with the tag "summary":
    <Abstract>
    {abstract}
    </Abstract>
    <Paragraphs>
    {[Summary.get(e).content for e in node.children() if Summary in e.attrs and Summary.get(e).content != "No summary"]}
    </Paragraphs>
        """
        try:
            result = chat.complete(expensive=False, parse="dict", cache=True)
            print(f"section{node.get_id()}:{result}")
            summary1 = result['summary']
            Summary.get(node).content = summary1
        except Exception as e:
            Summary.get(node).content = "Failed to generate summary"
    else:   # Currently no summary for figures
        if Summary not in node.attrs:
            Summary.get(node).content = "No summary"
    return True


if __name__ == "__main__":
    os.environ["OPENAI_API_KEY"] = "sk-proj-yswCDVDgrwrvOvgWWZgbT3BlbkFJXgPdF8oQ6Y1qc70ZFPrq"
    doc = url_to_tree("https://arxiv.org/html/2406.07003v1")
    #doc = url_to_tree("https://arxiv.org/html/2307.08177v3")
    abstract = generate_summary_of_abstract(doc)
    node_map_with_dependency(doc.iter_subtree_with_bfs(), partial(generate_summary_for_node, abstract=abstract), n_workers=20)
    #parallel_map(partial(generate_summary_for_node, abstract=abstract), doc.iter_subtree_with_bfs(), title="summary")
    doc.display(dev_mode=True)
    # # sleep for 10 seconds to keep the server running
    import time

    while True:
        time.sleep(1)
