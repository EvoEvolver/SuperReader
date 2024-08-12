import os
from functools import partial

from fibers.utils.mapping import node_map_with_dependency
from reader.caselaw_to_tree import get_caselaw_tree
from reader.sparsify import caselaw_sparse, high_quality_sparse
from reader.summary import generate_summary_for_node, high_quality_summary

if __name__ == "__main__":
    os.environ["OPENAI_API_KEY"] = "sk-proj-yswCDVDgrwrvOvgWWZgbT3BlbkFJXgPdF8oQ6Y1qc70ZFPrq"
    #url = "https://scholar.google.com/scholar_case?case=6657439937507584902"

    url = "https://scholar.google.com/scholar_case?case=4593667331706526094"

    #url = "https://scholar.google.com/scholar_case?case=3381199590391915384"
    root = get_caselaw_tree(url)

    high_quality_sparse = True
    high_quality_summary = True

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

    root.display(dev_mode=True)

