import litellm

from reader.nature_paper_to_tree import run_nature_paper_to_tree
import sys
import threading


def run(link, port):
    doc = run_nature_paper_to_tree(link)
    doc.display(interactive=True, host=f"localhost:{port}")


if __name__ == '__main__':
    link = sys.argv[1]
    port = int(sys.argv[2])
    api_key = sys.argv[3]
    litellm.openai_key = api_key
    p = threading.Thread(target=run, args=(link, port))
    p.start()
    max_hours = 5
    time_limit = max_hours * 60 * 60
    p.join(time_limit)
