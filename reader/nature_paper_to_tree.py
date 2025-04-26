from functools import partial
import mllm.config
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
not_download_figures_table = False

class NatureNode(Node):
    def __init__(self, source: BeautifulSoup | Tag, id: str, label: str, title: str = "",
                 content: str = ""):
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

    def set_soup(self, soup):
        self._html_soup = soup

    def set_children(self, children: List[Node]):
        self._children = children
        for c in self._children:
            c._parent = self


def pre_process_html_tree(soup: BeautifulSoup):
    for script in soup(["script", "style"]):
        script.decompose()


def replace_math_with_tex(soup: BeautifulSoup):
    for math in soup.find_all('span', class_='mathjax-tex'):
        script = math.text
        tex_element = BeautifulSoup("", "html.parser")
        tex_element.append(tex_element.new_tag('TeX', src=script))
        math.replace_with(tex_element)

def replace_braces(soup):
    elements_need_to_replace = []
    # replace { by &#123; and } by &#125; in all the text
    for element in soup.find_all(text=True):
        if '{' not in element and '}' not in element:
            continue
        new_soup = BeautifulSoup("", "html.parser")
        new_element = new_soup.new_tag('TextSpan', text=element)
        elements_need_to_replace.append((element, new_element))
    for old, new in elements_need_to_replace:
        old.replace_with(new)


def get_abstract_node(rootSoup: BeautifulSoup) -> NatureNode:
    source = rootSoup.find('section', attrs={
        'data-title': 'Abstract'
    }, recursive=True)
    content_wraper = source.find('div', class_='c-article-section')
    return NatureNode(source, content_wraper.get('id'), "abstract", "Abstract",
                      content_wraper.text)


def get_section_nodes(rootSoup: BeautifulSoup, sec_dict) -> list[NatureNode]:
    children = []
    mainContent = rootSoup.find('div', class_='main-content')
    if mainContent is None:
        raise Exception("Can't resolve main content. This is usually due to the page not being open access.")
    section_index = 1
    for section in mainContent.children:
        if not isinstance(section, Tag):
            continue
        print(f"section: {section.get('data-title')}")
        Section = NatureNode(section.find('div', class_='c-article-section__content'),
                             section.get('data-title'), "section",
                             str(section_index) + "." + section.get('data-title'), "")
        section_index += 1
        secId = section.find('h2')
        sec_dict[secId['id']] = Section.node_id
        build_tree(Section, sec_dict)
        children.append(Section)
        print("----------")
    return children


from urllib.parse import urljoin

base_url = 'https://link.springer.com'


def get_subsection_nodes(sectionSoup: BeautifulSoup, label, sec_dict) -> list[NatureNode]:
    def is_leaf(e):
        check_pass = (e.name == 'p' or e.name == 'ol' or (
                e.name == 'div' and bool(set(e.get('class', [])) & {'c-article-equation', 'c-article-table'}))
        )
        return check_pass

    def extract_table(e):
        def extract_fullsize_table_soup(e):
            table_link_tag = e.find('a', {'data-track-action': 'view table'})

            if table_link_tag and table_link_tag.has_attr('href'):
                relative_href = table_link_tag['href']
                full_url = urljoin(base_url, relative_href)

                response = requests.get(full_url)
                if response.status_code == 200:
                    return BeautifulSoup(response.text, 'html.parser')
                else:
                    print(f"Error on request: {response.status_code}")
                    return None
            else:
                print("Button not found")
                return None

        soup = extract_fullsize_table_soup(e)
        caption_tag = e.find('b', {'data-test': 'table-caption'})
        table_title = "Table"
        if caption_tag:
            table_title =  caption_tag.get_text(strip=True)


        table_soup = soup.find('div', class_='c-article-table-container')
        # set style for the table
        table_soup['style'] = 'font-size: 60%;'
        sectionSoup.append(table_soup)
        Table = NatureNode(table_soup, "t", "table",
                               table_title,
                               table_soup.__str__())
        return Table


    children = []
    is_leading = True
    temp_parent = None
    subsection_title = None
    subsection_id = None
    children_elements = list(sectionSoup.children)
    prev_para_node = None
    for i, e in enumerate(children_elements):
        if not isinstance(e, Tag):
            continue
        # print(i, e.name, label)
        if not is_leading and e.name in ['ol', 'ul']:
            if temp_parent:
                temp_parent.append(e)

        elif is_leading and is_leaf(e):  # case for leaf
            if e.name == 'p':  # for the text paragraph, or non text leading paragraph, generate a node
                Paragraph = NatureNode(e, "para", "paragraph",
                                       "",
                                       e.__str__())
                prev_para_node = Paragraph
                children.append(Paragraph)
            elif 'c-article-table' in e.get(
                    'class',[]):
                if not_download_figures_table:
                    continue
                children.append(extract_table(e))
            else:  # append equation or keypoints to the previous paragraph if possible
                new_soup = BeautifulSoup("<div></div>", "html.parser")
                new_div = new_soup.div
                new_div.append(prev_para_node.get_soup())
                new_div.append(e)
                prev_para_node.set_soup(new_div)

        elif e.name == 'div' and e.get('data-container-section') == 'figure':
            # if temp_parent:
            #     SubSection = NatureNode(temp_parent, "subsec", "subsection",
            #                             subsection_title, "")
            #     sec_dict[subsection_id] = SubSection.node_id
            #     build_tree(SubSection, sec_dict)
            #     children.append(SubSection)
            #     temp_parent = None
            a_tag = e.find('a', class_="c-article-section__figure-link")
            if a_tag and a_tag.has_attr('href'):
                if not_download_figures_table:
                    continue
                relative_url = a_tag['href']
                full_url = urljoin(base_url, relative_url)
                print('url:', full_url)
                try:
                    response = requests.get(full_url)
                    if response.status_code == 200:
                        fetched_html = response.text
                        soup = BeautifulSoup(fetched_html, 'html.parser')
                        img_tag = soup.find('article')
                        print("img:", img_tag)
                        if img_tag:
                            img_html = str(img_tag)
                        else:
                            img_html = e.__str__()
                    else:
                        img_html = e.__str__()
                except Exception as ex:
                    img_html = e.__str__()
            else:
                img_html = e.__str__()

            figure_caption = e.find('b', attrs={'data-test': "figure-caption-text"}).text
            Figure = NatureNode(e, "figure", "figure", figure_caption,
                                img_html)
            img = e.find('img', attrs={'aria-describedby': True})
            del img["width"]
            del img["height"]
            img["style"] = "max-width: 100%;"
            sec_dict[img['aria-describedby']] = Figure.node_id
            if temp_parent:
                temp_parent.append(e)
            else:
                children.append(Figure)
        elif (e.name == 'h3' and label == 'section') or (
                e.name == 'h4' and label == 'subsection'):
            if temp_parent:
                SubSection = NatureNode(temp_parent, "subsec", "subsection",
                                        subsection_title, "")
                sec_dict[subsection_id] = SubSection.node_id
                build_tree(SubSection, sec_dict)
                children.append(SubSection)

            is_leading = False
            soup = BeautifulSoup("", "html.parser")
            temp_parent = soup.new_tag("div")
            subsection_title = e.get_text(strip=True).strip()
            subsection_id = e['id']

            print("----------")
        elif temp_parent:
            temp_parent.append(e)
        else:
            print("discarded", e.__str__())
            pass
            # print(f"missed:{label},{temp_parent},{e.name},{sectionSoup.__str__()[:200]},\n\n\n{e.__str__()[:200]}")
    if temp_parent:
        SubSection = NatureNode(temp_parent, "subsec", "subsection",
                                subsection_title, "")
        sec_dict[subsection_id] = SubSection.node_id
        build_tree(SubSection, sec_dict)
        children.append(SubSection)
    return children


def build_tree(parent: NatureNode, sec_dict):
    if parent.get_id() == "root":
        title = parent.get_soup().find('h1', class_="c-article-title", recursive=True)
        if title is None:
            raise Exception("Can't resolve title")
        title = title.text
        print("Title:", title)
        parent.title = title

        author = parent.get_soup().find('ul', class_="c-article-author-list",
                                        recursive=True)
        if author is None:
            print("Can't resolve author")
        else:
            parent.content = author.__str__()

        Abstract = get_abstract_node(parent.get_soup())
        print("Abstract:", Abstract.content)

        parent.set_children([Abstract] + get_section_nodes(parent.get_soup(), sec_dict))

    elif parent.get_label() == "section":
        parent.set_children(
            get_subsection_nodes(parent.get_soup(), parent.get_label(), sec_dict))
    elif parent.get_label() == "subsection":
        parent.set_children(
            get_subsection_nodes(parent.get_soup(), parent.get_label(), sec_dict))
    return





def url_to_tree(url: str) -> NatureNode:
    html_source = requests.get(url).text
    return html_to_tree(html_source, url)


def html_to_tree(html_source, url):
    soup = BeautifulSoup(html_source, "html.parser")
    complete_relative_links(soup, url)
    pre_process_html_tree(soup)
    head = NatureNode(soup, "root", "root", "", "")
    sec_dict = {}
    build_tree(head, sec_dict)
    for n in head.iter_subtree_with_bfs():
        if len(n.children) > 0:
            continue
        replace_math_with_tex(n.get_soup())
        replace_braces(n.get_soup())
    for n in head.iter_subtree_with_bfs():
        if len(n.children) > 0:
            continue
        anchors = n.get_soup().find_all('a', attrs={
            'data-track-action': ['section anchor', 'figure anchor']})
        for a in anchors:  # Construct navigation between nodes
            href = a.get('href', '')
            if '#' in href:
                anchor_key = href.split('#')[-1]
            else:
                continue

            link_text = a.get_text(strip=True)

            node_nav = soup.new_tag('NodeNavigator')
            node_nav['nodeId'] = sec_dict[anchor_key] if anchor_key in sec_dict else '0'

            new_a = soup.new_tag('a')
            new_a.string = link_text
            node_nav.append(new_a)
            a.replace_with(node_nav)

        figure_a = n.get_soup().find_all('a', attrs={"data-test": "img-link"})
        for a in figure_a:
            del a["href"]
            figure_box = soup.new_tag('FigureBox')
            figure_box.append(a.find('img'))
            a.replace_with(figure_box)

        link_a = n.get_soup().find_all('a', attrs={"class": "c-article__pill-button"})
        # remove the links element
        for a in link_a:
            a.decompose()

        n.content = n.get_soup().__str__()
    RefSoup = soup.find('ul', class_="c-article-references", recursive=True)
    # Rematch references
    if not RefSoup:
        return head, soup
    return head, soup


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


def generate_summary_for_node(node: NatureNode, abstract: str) -> bool:
    if node.get_label() in ["figure", "table"]:
        Summary.get(node).content = None
        return True

    if len(node.children) == 0:
        generate_summary_for_leaf_node(abstract, node)
    elif len(node.children) > 0:  # Section/ Subsection
        for e in node.children:
            if Summary not in e.attrs:
                return False
        generate_summary_for_section_node(abstract, node)
    else:
        if Summary not in node.attrs:
            Summary.get(node).content = None
    return True


def generate_summary_for_section_node(abstract, node):
    #content_list = [Summary.get(e).get_summary_for_resummary() for e in node.children if
    #                Summary in e.attrs and Summary.get(e).has_summary()]
    content_list = []
    for e in node.children:
        if Summary in e.attrs and Summary.get(e).has_summary():
            if Summary.get(e).short_content != "":
                content_list.append("# "+Summary.get(e).short_content)
            else:
                content_list.append("# Subsection")
            content_list.append(Summary.get(e).get_summary_for_resummary())
            content_list.append("---")

    contents = "\n".join(content_list)

    chat = Chat(dedent=True)
    chat += f"""
    Here is an abstract of a scientific paper and a specific paragraph from the same paper. Please summarize the content of the section.
    <Abstract>
    {abstract}
    </Abstract>
    <Contents>
    {contents}
    </Contents>
    <Requirement>
    You are required to output a summary of the section contents in the format of 2~5 key points. The key points should not be more than 70 words in total. The key points should summary the original content comprehensively.
    Return your summary in with a JSON with a single key "points", whose value is a list with 3~5 JSON objects with the following keys:
    "point" (str): A key point of the section contents. The key point should be a complete sentence stating an important facts. 
    "evidence" (str): A copy of the original text that support the point.
    </Requirement>
        """
    try:
        result = chat.complete(expensive=high_quality_arxiv_summary, parse="dict",
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
    chat += f"""Here is an abstract of a scientific paper and a specific paragraph from the same paper. Please summarize the content of the section.
    <Abstract>
    {abstract}
    </Abstract>
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


def generate_summary_for_leaf_node(abstract, node):
    chat = Chat(dedent=True)
    chat += f"""Here is an abstract of a scientific paper and a specific paragraph from the same paper. Please read both and then summarize the paragraph in the context of the abstract. 
    <Abstract>
    {abstract}
    </Abstract>
    <Paragraph>
    {node.content}
    </Paragraph>
    <Requirement>
    You are required to output a summary of the paragraph in the format of 2~5 key points. The key points should not be more than 70 words in total. The key points should summary the original content comprehensively.
    Return your summary in with a JSON with a single key "points", whose value is a list with 3~5 JSON objects with the following keys:
    "point" (str): A key point of the paragraph. The key point should be a complete sentence stating an important facts. 
    "evidence" (str): A copy of the original text that support the point.
    </Requirement>
    """
    try:
        result = chat.complete(expensive=high_quality_arxiv_summary, parse="dict",
                               cache=True)
        Summary.get(node).summaries_with_evidence = result["points"]
    except Exception as e:
        Summary.get(node).content = "Failed to generate summary"

    chat = Chat(dedent=True)
    chat += f"""Here is an abstract of a scientific paper and a specific paragraph from the same paper.
    <Abstract>
    {abstract}
    </Abstract>
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

def adapt_tree_to_reader(head: Node, doc_soup):
    for node in head.iter_subtree_with_bfs():
        if len(node.children) > 0:
            continue
        node_soup = node.get_soup()
        # find all the <a> with href containing #ref-CR
        anchors = node_soup.find_all('a', href=re.compile(r'#ref-CR'))

        for anchor in anchors:
            tooltip_title = anchor.get('title', 'Reference')
            anchor['style'] = 'color: blue;'
            del anchor['href']
            del anchor['title']

            tooltip = doc_soup.new_tag('Tooltip', title=tooltip_title)
            box = doc_soup.new_tag('Box', component='span')

            anchor.wrap(box)
            box.wrap(tooltip)

        # node.content = node_soup.__str__()


def complete_relative_links(soup, base_url: str = "base"):
    print(f"baseurl:{base_url}")
    for a in soup.find_all('a', href=True, recursive=True):
        print(a.__str__())
        if a['href'].startswith('/'):
            print("matched")
            a['href'] = urljoin(base_url, a['href'])
            print("new href:", a['href'])
            a['target'] = '_blank'


def run_nature_paper_to_tree(html_source: str, url: str):
    doc, doc_soup = html_to_tree(html_source, url)
    complete_relative_links(doc_soup, url)
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

    node_map_with_dependency(doc.iter_subtree_with_bfs(),
                             partial(generate_summary_for_node,
                                     abstract=abstract_summary),
                             n_workers=20)
    adapt_tree_to_reader(doc, doc_soup)
    doc.content = abstract
    construct_related_figures(doc)

    for node in doc.iter_subtree_with_bfs():
        if len(node.children) > 0:
            continue
        node.content = node.get_soup().__str__()
    return doc


if __name__ == "__main__":
    import dotenv
    dotenv.load_dotenv()
    mllm.config.default_models.expensive = "gpt-4o"
    nature_url = "https://link.springer.com/article/10.1007/s10462-024-10902-3#Abs1"
    #nature_url = "https://link.springer.com/article/10.1007/s10462-024-10896-y"
    html_source = requests.get(nature_url).text
    doc = run_nature_paper_to_tree(html_source, nature_url)
    doc.display(dev_mode=True)
