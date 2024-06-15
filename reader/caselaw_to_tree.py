from fibers.data_loader.html_to_tree import url_to_tree

if __name__ == "__main__":
    doc = url_to_tree("https://scholar.google.com/scholar_case?case=16062632215534775045&q=trump&hl=en&as_sdt=2006")
    doc = doc.children()[0]

    first_level = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"]
    second_level = ["A", "B", "C", "D", "E", "F", "G", "H"]
    third_level = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]

    last_first_level = doc
    for child in list(doc.children()):
        if child.title in first_level:
            last_first_level = child
        if child.title in second_level+third_level:
            child.new_parent(last_first_level)

    doc.display()
