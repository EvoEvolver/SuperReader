from functools import partial
from markdownify import markdownify
from markdown import markdown
import os, sys

sys.path.append(os.path.abspath("../../FibersNext"))
sys.path.append(os.path.abspath("../../Forest"))
sys.path.append(os.path.abspath("../../SuperReader"))
sys.path.append(os.path.abspath("/app/FibersNext"))
sys.path.append(os.path.abspath("/app/Forest"))
from reader.reference import set_reference_obj, construct_related_figures
from mllm import Chat
import re
from typing import List

import requests
from bs4 import BeautifulSoup
from bs4 import Tag

from fibers.utils.mapping import node_map_with_dependency

from fibers.tree import Node
from reader.summary import Summary

high_quality_arxiv_summary = False


class NatureNode(Node):
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


def get_abstract_node(rootSoup: BeautifulSoup) -> NatureNode:
    source = rootSoup.find('section', attrs={
        'data-title': 'Abstract'
    }, recursive=True)
    content_wraper = source.find('div', class_='c-article-section')
    return NatureNode(source, content_wraper.get('id'), "abstract", "Abstract", content_wraper.text)


def get_section_nodes(rootSoup: BeautifulSoup) -> list[NatureNode]:
    children = []
    mainContent = rootSoup.find('div', class_='main-content')
    for section in mainContent.children:
        if not isinstance(section, Tag):
            continue
        print(f"section: {section.get('data-title')}")
        Section = NatureNode(section.find('div', class_='c-article-section__content'), section.get('data-title'), "section",
                             section.get('data-title'), "")
        build_tree(Section)
        children.append(Section)
        print("----------")
    return children


def get_subsection_nodes(sectionSoup: BeautifulSoup, label) -> list[NatureNode]:
    global arxiv_url
    children = []
    index_para = 1
    index_figure = 1
    is_leading = True
    temp_parent = None
    subsection_title = None
    children_elements = list(sectionSoup.children)
    prev_para = None
    for i, e in enumerate(children_elements):
        if not isinstance(e, Tag):
            continue
        print(i, e.name, label)
        if e.name == 'ol' and prev_para:
            prev_para.content += e.__str__()
        elif is_leading and (e.name=='p'):
            Paragraph = NatureNode(e, "para", "paragraph",
                                   "¶ " + str(index_para),
                                   e.__str__())
            prev_para = Paragraph
            children.append(Paragraph)
            index_para += 1
        elif e.name == 'div' and e.get('data-container-section') == 'figure':
            if temp_parent:
                SubSection = NatureNode(temp_parent, "subsec", "subsection",
                                        subsection_title, "")
                build_tree(SubSection)
                children.append(SubSection)
                temp_parent = None
            Figure = NatureNode(e, "figure", "figure", "¶ Figure " + str(index_figure),
                                   e.__str__())
            children.append(Figure)
            index_figure += 1
        elif (e.name == 'h3' and label == 'section') or (e.name=='h4' and label == 'subsection'):
            if temp_parent:
                SubSection = NatureNode(temp_parent, "subsec", "subsection",
                                        subsection_title, "")
                build_tree(SubSection)
                children.append(SubSection)

            is_leading = False
            soup = BeautifulSoup("", "html.parser")
            temp_parent = soup.new_tag("div")
            subsection_title = e.get_text(strip=True).strip()


            print("----------")
        elif temp_parent:
            print("para:", e.text)
            temp_parent.append(e)
    if temp_parent:
        SubSection = NatureNode(temp_parent, "subsec", "subsection",
                                subsection_title, "")
        build_tree(SubSection)
        children.append(SubSection)
        # elif e.name == 'figure':
        #     image_tags = e.find_all('img', class_='ltx_graphics', recursive=True)
        #     for image_tag in image_tags:
        #         if image_tag is not None and isinstance(image_tag, Tag):
        #             if 'src' in image_tag.attrs:
        #                 image_tag['src'] = arxiv_url + '/' + image_tag['src']
        #             if 'width' in image_tag.attrs and 'height' in image_tag.attrs:
        #                 # Make sure the image fit in the window
        #                 w, h = int(image_tag['width']), int(image_tag['height'])
        #                 div_max_width = 500
        #                 if w > div_max_width:
        #                     image_tag['width'] = str(div_max_width)
        #                     image_tag['height'] = f"{int(h * (div_max_width / w))}"
        #                     image_tag['style'] = "object-fit: contain;"
        #
        #     content = "<FigureBox>" + e.__str__() + "</FigureBox>"
        #     Figure = NatureNode(e, e['id'], "figure", "figure " + str(index_figure), content)
        #     # Figure = ArxivNode(e, e['id'], "figure", "figure " + str(index_figure), re.sub(r"\"([^\"]+)\.(png|jpg)\"", regrex_str, e.__str__()))
        #     children.append(Figure)
        #     index_figure += 1
    return children


def remove_tag(html_str, tag):
    import re
    pattern = rf'<{tag}[^>]*>.*?</{tag}>'
    return re.sub(pattern, '', html_str)


def build_tree(parent: NatureNode):
    if parent.get_id() == "root":
        title = parent.get_soup().find('h1', class_="c-article-title", recursive=True)
        if title is None:
            raise Exception("Can't resolve title")
        title = title.text
        print("Title:", title)
        parent.title = title

        author = parent.get_soup().find('ul', class_="c-article-author-list", recursive=True)
        if author is None:
            print("Can't resolve author")
        else:
            parent.content = author.__str__()

        Abstract = get_abstract_node(parent.get_soup())
        print("Abstract:", Abstract.content)

        parent.set_children([Abstract] + get_section_nodes(parent.get_soup()))

    elif parent.get_label() == "section":
        parent.set_children(get_subsection_nodes(parent.get_soup(),parent.get_label()))
    elif parent.get_label() == "subsection":
        parent.set_children(get_subsection_nodes(parent.get_soup(),parent.get_label()))
    return


def url_to_tree(url: str) -> NatureNode:
    global nature_url
    nature_url = url
    html_source = requests.get(url).text

    # try:
    #     with open("cached_page.html", "r", encoding="utf-8") as f:
    #         html_source = f.read()
    # except FileNotFoundError:
    #     print("Error: Cached HTML file not found.")

    # html_source = re.sub(rf'href="([^\'\"]+)"', r'href="\1" target="_blank"', html_source)
    soup = BeautifulSoup(html_source, "html.parser")
    # replace_math_with_tex(soup)
    pre_process_html_tree(soup)
    head = NatureNode(soup, "root", "root", "", "")
    build_tree(head)

    RefSoup = soup.find('ul', class_="c-article-references", recursive=True)
    # Rematch references
    if not RefSoup:
        return head
    for c in head.iter_subtree_with_bfs():
        html_string = c.content
        pattern = r'href="[^"]*#ref-CR(\d+)"'
        matches = re.findall(pattern, html_string)
        # extract reference number
        extracted_numbers = [match for match in matches]
        print("Extracted Numbers:", extracted_numbers)
        # replacement_pattern = r'href="[^"]*#ref-CR\d+"'
        # c.content = re.sub(replacement_pattern, "style='color: cyan;'", html_string)

        pattern = r'<a\b[^>]*?href="[^"]*#ref-CR\d+"[^>]*>.*?</a>'
        def add_tooltip_wrapper(match):
            full_tag = match.group(0)
            title_match = re.search(r'title="([^"]*)"', full_tag)
            tooltip_title = title_match.group(1) if title_match else "Reference"
            modified_tag = re.sub(
                r'\shref="[^"]*#ref-CR\d+"',
                ' style="color: cyan;"',
                full_tag
            )

            return f'<Tooltip title="{tooltip_title}">{modified_tag}</Tooltip>'
        c.content = re.sub(pattern, add_tooltip_wrapper, html_string, flags=re.DOTALL)
        print("c.content:", c.content)
        if matches:
            references = []
            for number in matches:
                ref_text = RefSoup.find('li', class_='c-article-references__item', attrs={
        'data-counter': f'{number}.'
    })
                # ref_content = RefSoup.find('li', class_='ltx_bibitem', recursive=True, id=f'bib.bib{number}')
                references.append(f'<a style=\'color: cyan;\'>{number}.</a>{ref_text.__str__()}')
            set_reference_obj(c, references)

    return head


def generate_summary_of_abstract(root: Node):
    for node in root.iter_subtree_with_bfs():
        if node.title == "Abstract":
            chat = Chat()
            chat += f"""This is an Abstract of a scientific paper, please write a 80 words summary about what this paper about from the summary, and a 20 words brief describe about the content. For both the summary and the brief describe, please start directly with meaningful content and DON'T add meaning less leading words like 'Thi paper tells'/'This paragraph tells'. return the summary in JSON format with the tag "summary", and the brief describe with tag "brief".
                <Abstract>
                {node.content}
                </Abstract>
                """
            try:

                abstract_summary = chat.complete(expensive=high_quality_arxiv_summary, parse="dict", cache=True)[
                    "summary"]
                short_summary = chat.complete(expensive=high_quality_arxiv_summary, parse="dict", cache=True)["brief"]

                return abstract_summary, short_summary
            except Exception as e:
                abstract = node.content
            return abstract
        else:
            continue


def generate_summary_for_node(node: NatureNode, abstract: str) -> bool:
    if node.get_label() == "figure":
        Summary.get(node).content = None
        return True
    if len(node.children) == 0:
        chat = Chat(dedent=True)
        chat += f"""Providing an abstract of a scientific paper and a specific paragraph from the same paper. Please read both and then summarize the paragraph in the context of the abstract. 
    <Abstract>
    {abstract}
    </Abstract>
    <Paragraph>
    {markdownify(node.content)}
    </Paragraph>
    <Requirement>
    You are required to output a summary of the paragraph in the format of bullet points (in markdown). The summary should not be more than 50 words in total.
    You are also required to output a keypoint for no more than 10 words which could use for a Table of Contents. 
    Return your summary in JSON format with the following keys:
    "summary" (str): The summary in markdown, with each bullet point in a new line and starting with a dash.
    "keypoint" (str): The keypoint
    </Requirement>
        """
        try:
            result = chat.complete(expensive=high_quality_arxiv_summary, parse="dict", cache=True)
            print("paragraph:", result)
            if node.content == "":
                print()
            summary = markdown(result["summary"])
            Summary.get(node).content = summary
            node.title = f"{node.title}: {result['keypoint']}"
        except Exception as e:
            Summary.get(node).content = "Failed to generate summary"
    elif len(node.children) > 0:  # Section/ Subsection
        chat = Chat(dedent=True)
        for e in node.children:
            if Summary not in e.attrs:
                return False
        content_list = [Summary.get(e).content for e in node.children if
                        Summary in e.attrs and Summary.get(e).content != None]
        contents = "\n".join(content_list)
        chat += f"""
        Please summarize the section of a scientific paper. 
    <Abstract>
    {abstract}
    </Abstract>
    <Contents>
    {contents}
    </Contents>
    <Requirement>
    You are required to output a summary of the section in the format of bullet points (in markdown). The summary should not be more than 100 words in total.
    You are also required to output a keypoint of the section for no more than 30 words which could use for a Table of Contents. 
    Notice that for both the summary and the keypoint describe, please start directly with meaningful content and DON'T add meaning less leading words like 'Thi paper tells'/'This paragraph tells'.
    Return your summary in JSON format with the following keys:
    "summary" (str): The summary in markdown, with each bullet point in a new line and starting with a dash.
    "keypoint" (str): The keypoint
    </Requirement>
        """
        try:
            result = chat.complete(expensive=high_quality_arxiv_summary, parse="dict", cache=True)
            print(f"section{node.get_id()}:{result}")
            summary1 = markdown(result["summary"])
            short_summary = result['keypoint']
            Summary.get(node).content = summary1
            Summary.get(node).short_content = short_summary

            node_title_summary = []
            for child in node.children:
                node_title_summary.append(f"<strong>{child.title}</strong>")
                if Summary.get(child).short_content:
                    node_title_summary.append(f"{Summary.get(child).short_content}")

            node_content = '\n\n<br/>'.join(node_title_summary)
            node.content = node_content

        except Exception as e:
            Summary.get(node).content = "Failed to generate summary"
    else:
        if Summary not in node.attrs:
            Summary.get(node).content = None
    return True


def generate_tree_with_url(url: str, host: str) -> str:
    os.environ["OPENAI_API_KEY"] = "sk-proj-yswCDVDgrwrvOvgWWZgbT3BlbkFJXgPdF8oQ6Y1qc70ZFPrq"
    arxiv_url = url  # "https://arxiv.org/html/2407.12105v2"
    doc = url_to_tree(arxiv_url)
    abstract_summary, short_summary = generate_summary_of_abstract(doc)

    for node in doc.iter_subtree_with_bfs():
        if "section" in node._label:
            if len(node.children) == 0:
                node.content = node._html_soup.__str__()
            if len(node.children) == 1:
                child = node.children[0]
                if child._label == "paragraph":
                    node.content = child.content
                    child.remove_self()
        if node._label == "figure":
            print(node._id)

    for node in doc.iter_subtree_with_bfs():
        if node.title == "Abstract":
            node.remove_self()
            break

    node_map_with_dependency(doc.iter_subtree_with_bfs(), partial(generate_summary_for_node, abstract=abstract_summary),
                             n_workers=20)
    construct_related_figures(doc)
    doc.content = ""
    Summary.get(doc).short_content = short_summary
    return doc.display(dev_mode=False, interactive=False, host=host)


#
if __name__ == "__main__":
    os.environ["OPENAI_API_KEY"] = "sk-proj-yswCDVDgrwrvOvgWWZgbT3BlbkFJXgPdF8oQ6Y1qc70ZFPrq"
    nature_url = "https://link.springer.com/article/10.1007/s10462-024-10974-1"

    high_quality_arxiv_summary = True

    doc = url_to_tree(nature_url)


    abstract_summary, short_summary = generate_summary_of_abstract(doc)

    for node in doc.iter_subtree_with_bfs():
        if "section" in node._label:
            if len(node.children) == 0:
                node.content = node._html_soup.__str__()
            if len(node.children) == 1:
                child = node.children[0]
                if child._label == "paragraph":
                    node.content = child.content
                    child.remove_self()
        if node._label == "figure":
            print(node._id)

    abstract = ""
    for node in doc.iter_subtree_with_bfs():
        if node.title == "Abstract":
            abstract = node.content
            node.remove_self()
            break

    node_map_with_dependency(doc.iter_subtree_with_bfs(), partial(generate_summary_for_node, abstract=abstract_summary),
                             n_workers=20)
    doc.content = abstract
    construct_related_figures(doc)
    doc.display(dev_mode=True, interactive=True)
