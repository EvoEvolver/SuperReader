from __future__ import annotations

import json
from typing import TYPE_CHECKING, Dict, TypedDict, Optional

import requests

from fastapi import HTTPException

if TYPE_CHECKING:
    from tree import Node


class TreeMetaData(TypedDict):
    rootId: str


class NodeJson(TypedDict):
    title: str
    id: str
    parent: str | None
    children: list[str]
    data: dict[str, str]
    tools: Optional[list[dict[str, str]]]
    tabs: Optional[dict[str, str]]
    nodeTypeName: str


class TreeData(TypedDict):
    metadata: TreeMetaData
    nodeDict: Dict[str, NodeJson]


class Rendered:
    def __init__(self, node):
        self.node: Node = node
        self.tabs = {}
        self.tools = [{}, {}]
        self.children = []
        self.title = node.title
        self.data = {}
        self.node_type = ""

    def to_json(self, node_dict):
        if self.node.node_id in node_dict:
            return
        node_json = self.to_json_without_children()
        # Add children
        for child in self.children:
            child.to_json(node_dict)
        node_dict[str(self.node.node_id)] = node_json

    def to_json_without_children(self) -> NodeJson:
        children_ids = []
        for child in self.children:
            children_ids.append(str(child.node.node_id))
        parent_id = str(self.node._parent.node_id) if self.node._parent else None
        node_json: NodeJson = {
            "title": self.title,
            "tabs": self.tabs,
            "tools": self.tools,
            "children": children_ids,
            "id": str(self.node.node_id),
            "parent": parent_id,
            "data": self.data,
            "nodeTypeName": self.node_type,
        }
        return node_json


class Renderer:

    @staticmethod
    def node_handler(node: Node, rendered: Rendered):
        for attr_class, attr_value in node.attrs.items():
            attr_value.render(rendered)

    @staticmethod
    def render(node: Node) -> Rendered:
        rendered = Rendered(node)
        Renderer.node_handler(node, rendered)
        for child in node.children:
            rendered.children.append(Renderer.render(child))
        return rendered

    @staticmethod
    def render_to_json(node: Node) -> TreeData:
        node_dict = {}
        Renderer.render(node).to_json(node_dict)
        treedata: TreeData = {
            "metadata": {"rootId": str(node.node_id)},
            "nodeDict": node_dict,
        }
        return treedata


def push_tree_data(tree_data: TreeData, host: str = "http://0.0.0.0:29999", token: Optional[str] = None) -> str:
    root_id = tree_data["metadata"]["rootId"]
    payload = json.dumps({
        "tree": tree_data,
        "root_id": str(root_id),
    })
    headers = {
        'Content-Type': 'application/json'
    }
    if token is not None:
        headers['Authorization'] = f'Bearer {token}'

    response = requests.request("PUT", f'{host}/api/createTree', headers=headers, data=payload)
    try:
        response.raise_for_status()
        response_data = response.json()
        if 'tree_id' in response_data:
            tree_id = response_data['tree_id']
            print(f"Created tree to {host}/?id={tree_id}")
            return tree_id
        else:
            raise HTTPException(status_code=500, detail="Tree updated but no tree_id returned.")
    except requests.exceptions.RequestException as e:
        raise HTTPException(status_code=500, detail=f"Failed to update tree: {str(e)}")
