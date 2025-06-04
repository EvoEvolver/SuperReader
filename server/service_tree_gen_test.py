import requests

if __name__ == '__main__':
    link = "https://link.springer.com/article/10.1007/s10462-024-10896-y"
    html_source = requests.get(link).text
    payload = {
        "url": link,
        "html_source": html_source,
    }
    response = requests.post("http://127.0.0.1:8081/generate", json=payload)
    response.raise_for_status()
    data = response.json()
    tree_data = data.get("tree_data")
    print(tree_data)