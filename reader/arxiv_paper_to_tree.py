import os
import re

from fibers.data_loader.arxiv_html_to_tree import url_to_tree
from reader.summary import *
from mllm import Chat, debug, caching
from fibers.data_loader.arxiv_html_to_tree import ArxivNode


def generate_summary_for_tree(chat: Chat, root: ArxivNode):
    abstract = ""
    if root.children()[0].title == "Abstract":
        chat += f"""This is an Abstract of a scientific paper, please write a 50 words summary about what this paper about from the summary, return the summary in JSON format with the tag "summary"
        <Abstract>
        {root.children()[0].content}
        </Abstract>
        """
        try:
            abstract = chat.complete(expensive=True, parse="dict", cache=True)["summary"]
            set_summary_obj(root.children()[0], abstract)
        except Exception as e:
            abstract = root.children()[0].content
    else:
        print("Failed to get abstract")
        return

    for child in reversed(list(root.iter_subtree_with_bfs())):
        if 'p' in child.get_id():  # Paragraph
            chat += f"""Providing an abstract of a scientific paper and a specific paragraph from the same paper. Please read both and then summarize the paragraph in the context of the abstract. Make sure the summary for no more than 50 words, and make a keypoint for no more than 10 words which could use for a Table of Contents. Return your summary in JSON format with the tag "summary", the key point with tag "keypoint.
        <Abstract>
        {abstract}
        </Abstract>
        <Paragraph>
        {child.content}
        </Paragraph>
            """
            try:
                result = chat.complete(expensive=True, parse="dict", cache=True)
                print("paragraph:", result)
                set_summary_obj(child, result['summary'])
                child.title = f"{child.title}: {result['keypoint']}"
            except Exception as e:
                set_summary_obj(child, "Failed to generate summary")
        elif re.match(r'^S\d+\.SS\d+$', child.get_id()) or re.match(r'^S\d+$', child.get_id()):  # Subsection
            chat += f"""
            Please summarize the section of a scientific paper. You will be provide the abstract of the paper, and the summary of each paragraph in this subsection. Return the summary (About 100 words) of the subsection in JSON format with the tag "summary":
        <Abstract>
        {abstract}
        </Abstract>
        <Paragraphs>
        {[get_summary(e) for e in child.children() if Summary in e.attrs]}
        </Paragraphs>
            """
            try:
                result = chat.complete(expensive=True, parse="dict", cache=True)
                print(f"section{child.get_id()}:{result}")
                set_summary_obj(child, result['summary'])
            except Exception as e:
                set_summary_obj(child, "Failed to generate summary")


if __name__ == "__main__":
    os.environ["OPENAI_API_KEY"] = "sk-proj-yswCDVDgrwrvOvgWWZgbT3BlbkFJXgPdF8oQ6Y1qc70ZFPrq"
  #  doc = url_to_tree("https://arxiv.org/html/2406.07003v1")
    doc = url_to_tree("https://arxiv.org/html/2307.08177v3")

    chat = Chat()
    generate_summary_for_tree(chat, doc)
    doc.display(dev_mode=True)

    # # sleep for 10 seconds to keep the server running
    import time

    while True:
        time.sleep(1)
