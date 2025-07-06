"""
Nature Paper to Tree Converter

This module converts Nature journal articles from HTML to a tree structure
for the SuperReader application.
"""

import re
from typing import Dict, List, Optional, Tuple, Union
from urllib.parse import urljoin

import mllm.config
import requests
from bs4 import BeautifulSoup, Tag

from tree import Node
from tree.helper import node_map_with_dependency

# Configuration
NOT_DOWNLOAD_FIGURES_TABLE = False
BASE_URL = 'https://link.springer.com'


class PaperNode(Node):
    """A specialized Node class for representing paper content."""
    
    def __init__(self, source: BeautifulSoup, label: str, title: str = "", content: str = ""):
        super().__init__(title, content)
        self._label: str = label
        self._html_soup: BeautifulSoup = source

    def get_label(self) -> str:
        """Get the node label."""
        return self._label

    def get_soup(self) -> BeautifulSoup:
        """Get the BeautifulSoup object."""
        return self._html_soup

    def set_soup(self, soup: BeautifulSoup) -> None:
        """Set the BeautifulSoup object."""
        self._html_soup = soup

    def set_children(self, children: List[Node]) -> None:
        """Set children and establish parent relationships."""
        self._children = children
        for child in self._children:
            child._parent = self


# ============================================================================
# HTML Processing Utilities
# ============================================================================

def pre_process_html_tree(soup: BeautifulSoup) -> None:
    """Remove script and style tags from the HTML."""
    for script in soup(["script", "style"]):
        script.decompose()


def replace_math_with_tex(soup: BeautifulSoup) -> None:
    """Replace MathJax elements with TeX tags."""
    for math in soup.find_all('span', class_='mathjax-tex'):
        script = math.text
        tex_element = BeautifulSoup("", "html.parser")
        tex_element.append(tex_element.new_tag('TeX', src=script))
        math.replace_with(tex_element)


def replace_braces(soup: BeautifulSoup) -> None:
    """Replace braces in text with HTML entities."""
    elements_to_replace = []
    for element in soup.find_all(text=True):
        element_text = str(element)
        if '{' not in element_text and '}' not in element_text:
            continue
        new_soup = BeautifulSoup("", "html.parser")
        new_element = new_soup.new_tag('TextSpan', text=element_text)
        elements_to_replace.append((element, new_element))
    
    for old, new in elements_to_replace:
        old.replace_with(new)


def complete_relative_links(soup: BeautifulSoup, base_url: str) -> None:
    """Convert relative links to absolute URLs."""
    print(f"Processing links with base URL: {base_url}")
    for link in soup.find_all('a', href=True, recursive=True):
        href = link.get('href', '')
        if isinstance(href, str) and href.startswith('/'):
            link['href'] = urljoin(base_url, href)
            link['target'] = '_blank'


# ============================================================================
# Content Extraction Functions
# ============================================================================

def get_abstract_node(root_soup: BeautifulSoup) -> PaperNode:
    """Extract the abstract section from the paper."""
    source = root_soup.find('section', attrs={'data-title': 'Abstract'}, recursive=True)
    if not source:
        raise ValueError("Abstract section not found")
    
    content_wrapper = source.find('div', class_='c-article-section')
    if not content_wrapper:
        raise ValueError("Abstract content wrapper not found")
    
    return PaperNode(source, "abstract", "Abstract", content_wrapper.text)


def get_section_nodes(root_soup: BeautifulSoup, sec_dict: Dict[str, str]) -> List[PaperNode]:
    """Extract all section nodes from the main content."""
    children = []
    main_content = root_soup.find('div', class_='main-content')
    
    if main_content is None:
        raise ValueError("Can't resolve main content. This is usually due to the page not being open access.")
    
    section_index = 1
    for section in main_content.children:
        if not isinstance(section, Tag):
            continue
            
        section_title = section.get('data-title', '')
        print(f"Processing section: {section_title}")
        
        section_content = section.find('div', class_='c-article-section__content')
        if not section_content:
            continue
            
        section_node = PaperNode(
            section_content,
            "section",
            f"{section_index}.{section_title}",
            ""
        )
        section_index += 1
        
        # Store section ID mapping
        sec_id = section.find('h2')
        if sec_id and sec_id.get('id'):
            sec_dict[sec_id['id']] = section_node.node_id
        
        build_tree(section_node, sec_dict)
        children.append(section_node)
    
    return children


# ============================================================================
# Subsection and Element Processing
# ============================================================================

def _is_leaf_element(element: Tag) -> bool:
    """Check if an element is a leaf node (paragraph, list, equation, or table)."""
    if element.name == 'p' or element.name == 'ol':
        return True
    
    if element.name == 'div':
        classes = element.get('class', [])
        return bool(set(classes) & {'c-article-equation', 'c-article-table'})
    
    return False


def _extract_table(element: Tag, section_soup: BeautifulSoup) -> Optional[PaperNode]:
    """Extract table content and create a table node."""
    def _get_fullsize_table_soup(table_element: Tag) -> Optional[BeautifulSoup]:
        table_link_tag = table_element.find('a', {'data-track-action': 'view table'})
        
        if not table_link_tag or not table_link_tag.has_attr('href'):
            print("Table link not found")
            return None
        
        relative_href = table_link_tag['href']
        full_url = urljoin(BASE_URL, relative_href)
        
        try:
            response = requests.get(full_url)
            if response.status_code == 200:
                return BeautifulSoup(response.text, 'html.parser')
            else:
                print(f"Error fetching table: {response.status_code}")
                return None
        except Exception as e:
            print(f"Error fetching table: {e}")
            return None

    # Get table content
    table_soup = _get_fullsize_table_soup(element)
    if not table_soup:
        return None
    
    # Extract table title
    caption_tag = element.find('b', {'data-test': 'table-caption'})
    table_title = caption_tag.get_text(strip=True) if caption_tag else "Table"
    
    # Find table container
    table_container = table_soup.find('div', class_='c-article-table-container')
    if not table_container:
        return None
    
    # Set table style
    table_container['style'] = 'font-size: 60%;'
    section_soup.append(table_container)
    
    return PaperNode(table_container, "table", table_title, str(table_container))


def _extract_figure(element: Tag, sec_dict: Dict[str, str]) -> Optional[PaperNode]:
    """Extract figure content and create a figure node."""
    a_tag = element.find('a', class_="c-article-section__figure-link")
    
    if a_tag and a_tag.has_attr('href') and not NOT_DOWNLOAD_FIGURES_TABLE:
        relative_url = a_tag['href']
        full_url = urljoin(BASE_URL, relative_url)
        try:
            # Currently disabled for speed
            response = None  # requests.get(full_url)
            #print(f'Fetching figure from: {full_url}')
            if response and response.status_code == 200:
                fetched_html = response.text
                soup = BeautifulSoup(fetched_html, 'html.parser')
                img_tag = soup.find('article')
                img_html = str(img_tag) if img_tag else str(element)
            else:
                img_html = str(element)
        except Exception as e:
            print(f"Error fetching figure: {e}")
            img_html = str(element)
    else:
        img_html = str(element)

    # Extract figure caption
    caption_tag = element.find('b', attrs={'data-test': "figure-caption-text"})
    if not caption_tag:
        return None
    
    figure_caption = caption_tag.text
    figure_node = PaperNode(element, "figure", figure_caption, img_html)
    
    # Process image attributes
    img = element.find('img', attrs={'aria-describedby': True})
    if img:
        img.attrs.pop('width', None)
        img.attrs.pop('height', None)
        img['style'] = "max-width: 100%;"
        
        if img.get('aria-describedby'):
            sec_dict[img['aria-describedby']] = figure_node.node_id
    
    return figure_node


def get_subsection_nodes(section_soup: BeautifulSoup, label: str, sec_dict: Dict[str, str]) -> List[PaperNode]:
    """Extract subsection nodes from a section."""
    children = []
    is_leading = True
    temp_parent: Optional[BeautifulSoup] = None
    subsection_title: Optional[str] = None
    subsection_id: Optional[str] = None
    prev_para_node: Optional[PaperNode] = None
    
    for element in section_soup.children:
        if not isinstance(element, Tag):
            continue
        
        # Handle lists in subsections
        if not is_leading and element.name in ['ol', 'ul']:
            if temp_parent:
                temp_parent.append(element)
        
        # Handle leaf elements
        elif is_leading and _is_leaf_element(element):
            if element.name == 'p':
                paragraph_node = PaperNode(element, "paragraph", "", str(element))
                prev_para_node = paragraph_node
                children.append(paragraph_node)
            elif 'c-article-table' in element.get('class', []):
                if not NOT_DOWNLOAD_FIGURES_TABLE:
                    table_node = _extract_table(element, section_soup)
                    if table_node:
                        children.append(table_node)
            else:
                # Append equation or keypoints to previous paragraph
                if prev_para_node:
                    new_soup = BeautifulSoup("<div></div>", "html.parser")
                    new_div = new_soup.div
                    new_div.append(prev_para_node.get_soup())
                    new_div.append(element)
                    prev_para_node.set_soup(new_div)
        
        # Handle figures
        elif element.name == 'div' and element.get('data-container-section') == 'figure':
            figure_node = _extract_figure(element, sec_dict)
            if figure_node:
                if temp_parent:
                    temp_parent.append(element)
                else:
                    children.append(figure_node)
        
        # Handle subsection headers
        elif ((element.name == 'h3' and label == 'section') or 
              (element.name == 'h4' and label == 'subsection')):
            
            # Finalize previous subsection
            if temp_parent and subsection_title and subsection_id:
                subsection_node = PaperNode(temp_parent, "subsection", subsection_title, "")
                sec_dict[subsection_id] = subsection_node.node_id
                build_tree(subsection_node, sec_dict)
                children.append(subsection_node)
            
            # Start new subsection
            is_leading = False
            soup = BeautifulSoup("", "html.parser")
            temp_parent = soup.new_tag("div")
            subsection_title = element.get_text(strip=True).strip()
            subsection_id = element.get('id')
            print("----------")
        
        # Add to current subsection
        elif temp_parent:
            temp_parent.append(element)
        else:
            print(f"Discarded element: {element.name}")
    
    # Finalize last subsection
    if temp_parent and subsection_title and subsection_id:
        subsection_node = PaperNode(temp_parent, "subsection", subsection_title, "")
        sec_dict[subsection_id] = subsection_node.node_id
        build_tree(subsection_node, sec_dict)
        children.append(subsection_node)
    
    return children


# ============================================================================
# Tree Building
# ============================================================================

def build_tree(parent: PaperNode, sec_dict: Dict[str, str]) -> None:
    """Build the tree structure recursively."""
    if parent.get_label() == "root":
        # Extract title
        title_element = parent.get_soup().find('h1', class_="c-article-title", recursive=True)
        if not title_element:
            raise ValueError("Can't resolve title")
        
        parent.title = title_element.text
        print(f"Title: {parent.title}")
        
        # Extract authors
        author_element = parent.get_soup().find('ul', class_="c-article-author-list", recursive=True)
        if author_element:
            parent.content = str(author_element)
        else:
            print("Can't resolve authors")
        
        # Extract abstract and sections
        abstract_node = get_abstract_node(parent.get_soup())
        print(f"Abstract: {abstract_node.content}")
        
        section_nodes = get_section_nodes(parent.get_soup(), sec_dict)
        parent.set_children([abstract_node] + section_nodes)
    
    elif parent.get_label() in ["section", "subsection"]:
        subsection_nodes = get_subsection_nodes(parent.get_soup(), parent.get_label(), sec_dict)
        parent.set_children(subsection_nodes)


# ============================================================================
# HTML to Tree Conversion
# ============================================================================

def html_to_tree(html_source: str, url: str) -> Tuple[PaperNode, BeautifulSoup]:
    """Convert HTML source to a tree structure."""
    soup = BeautifulSoup(html_source, "html.parser")
    complete_relative_links(soup, url)
    pre_process_html_tree(soup)
    
    head = PaperNode(soup, "root", "", "")
    sec_dict: Dict[str, str] = {}
    build_tree(head, sec_dict)
    
    # Process leaf nodes
    for node in head.iter_subtree_with_bfs():
        if len(node.children) > 0:
            continue
        
        if isinstance(node, PaperNode):
            replace_math_with_tex(node.get_soup())
            replace_braces(node.get_soup())
    
    # Process navigation and links
    for node in head.iter_subtree_with_bfs():
        if len(node.children) > 0:
            continue
        
        if not isinstance(node, PaperNode):
            continue
            
        node_soup = node.get_soup()
        
        # Process section and figure anchors
        anchors = node_soup.find_all('a', attrs={
            'data-track-action': ['section anchor', 'figure anchor']
        })
        
        for anchor in anchors:
            href = anchor.get('href', '')
            if '#' in href:
                anchor_key = href.split('#')[-1]
                link_text = anchor.get_text(strip=True)
                
                node_nav = soup.new_tag('NodeNavigator')
                node_nav['nodeId'] = sec_dict.get(anchor_key, '0')
                
                new_a = soup.new_tag('a')
                new_a.string = link_text
                node_nav.append(new_a)
                anchor.replace_with(node_nav)
        
        # Process figure links
        figure_links = node_soup.find_all('a', attrs={"data-test": "img-link"})
        for link in figure_links:
            link.attrs.pop('href', None)
            figure_box = soup.new_tag('FigureBox')
            img = link.find('img')
            if img:
                figure_box.append(img)
            link.replace_with(figure_box)
        
        # Remove pill buttons
        pill_buttons = node_soup.find_all('a', attrs={"class": "c-article__pill-button"})
        for button in pill_buttons:
            button.decompose()
        
        node.content = str(node_soup)
    
    return head, soup


def url_to_tree(url: str) -> Tuple[PaperNode, BeautifulSoup]:
    """Convert a URL to a tree structure."""
    html_source = requests.get(url).text
    return html_to_tree(html_source, url)


# ============================================================================
# Tree Adaptation for Reader
# ============================================================================

def adapt_tree_to_reader(head: Node, doc_soup: BeautifulSoup) -> None:
    """Adapt the tree for reader display."""
    for node in head.iter_subtree_with_bfs():
        if len(node.children) > 0:
            continue
        
        if not isinstance(node, PaperNode):
            continue
            
        node_soup = node.get_soup()
        if not node_soup:
            continue
        
        # Process reference links
        anchors = node_soup.find_all('a', href=re.compile(r'#ref-CR'))
        
        for anchor in anchors:
            tooltip_title = anchor.get('title', 'Reference')
            anchor['style'] = 'color: blue;'
            anchor.attrs.pop('href', None)
            anchor.attrs.pop('title', None)
            
            tooltip = doc_soup.new_tag('Tooltip', title=tooltip_title)
            box = doc_soup.new_tag('Box', component='span')
            
            anchor.wrap(box)
            box.wrap(tooltip)


# ============================================================================
# Main Processing Function
# ============================================================================

def run_nature_paper_to_tree(html_source: str, url: str) -> PaperNode:
    """Main function to convert Nature paper HTML to tree structure."""
    doc, doc_soup = html_to_tree(html_source, url)
    complete_relative_links(doc_soup, url)
    
    # Process section nodes
    for node in doc.iter_subtree_with_bfs():
        if not isinstance(node, PaperNode):
            continue
            
        if "section" in node._label:
            if len(node.children) == 0:
                node.content = str(node._html_soup)
            elif len(node.children) == 1:
                child = node.children[0]
                if isinstance(child, PaperNode) and child._label == "paragraph":
                    node.content = child.content
                    child.remove_self()
    
    # Extract and remove abstract
    abstract_content = ""
    for node in doc.iter_subtree_with_bfs():
        if node.title == "Abstract":
            abstract_content = node.content
            node.remove_self()
            break
    
    # Generate summaries
    from reader.build_summary import generate_summary_for_node
    node_map_with_dependency(list(doc.iter_subtree_with_bfs()), generate_summary_for_node, n_workers=20)
    
    # Adapt for reader
    adapt_tree_to_reader(doc, doc_soup)
    doc.content = abstract_content
    
    # Construct related figures
    from reader.reference import construct_related_figures
    construct_related_figures(doc)
    
    return doc


# ============================================================================
# Main Execution
# ============================================================================

if __name__ == "__main__":
    import dotenv
    
    dotenv.load_dotenv()
    mllm.config.default_models.expensive = "gpt-4o"
    
    nature_url = "https://www.nature.com/articles/s41557-025-01815-x"
    html_source = requests.get(nature_url).text
    doc = run_nature_paper_to_tree(html_source, nature_url)
    
    # Uncomment to push tree to database
    # from forest.tree import push_tree
    doc.render_and_push()