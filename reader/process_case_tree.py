from functools import partial

from fibers.utils.mapping import node_map_with_dependency
from reader.caselaw_to_tree import get_caselaw_tree
from reader.sparsify import caselaw_sparse
from reader.summary import generate_summary_for_node

if __name__ == "__main__":
    url = "https://scholar.google.com/scholar_case?case=16062632215534775045&q=trump+v+hawaii&hl=en&as_sdt=2006"
    root = get_caselaw_tree(url)

    node_map_with_dependency(root.iter_subtree_with_bfs(),
                             partial(generate_summary_for_node),
                             n_workers=20)
    caselaw_sparse(root)

    root.display()
    exit(0)

