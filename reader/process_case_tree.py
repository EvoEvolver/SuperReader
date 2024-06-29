import os
from functools import partial

from fibers.utils.mapping import node_map_with_dependency
from reader.caselaw_to_tree import get_caselaw_tree
from reader.sparsify import caselaw_sparse
from reader.summary import generate_summary_for_node

if __name__ == "__main__":
    os.environ["OPENAI_API_KEY"] = "sk-proj-yswCDVDgrwrvOvgWWZgbT3BlbkFJXgPdF8oQ6Y1qc70ZFPrq"
    url = "https://scholar.google.com/scholar_case?case=6657439937507584902&q=trump&hl=en&as_sdt=2006"
    root = get_caselaw_tree(url)

    node_map_with_dependency(root.iter_subtree_with_bfs(),
                             partial(generate_summary_for_node),
                             n_workers=20)

    nodes_need_sparse = []
    for child in reversed(list(root.iter_subtree_with_bfs())):
        if len(child.children()) < 7:  # Only sparse the tree when more than 5 children
            continue
        if any(len(c.children()) > 0 for c in child.children()):
            continue
        nodes_need_sparse.append(child)

    node_map_with_dependency(nodes_need_sparse,
                             partial(caselaw_sparse),
                             n_workers=20)
    # caselaw_sparse(root)

    root.display()
    exit(0)

