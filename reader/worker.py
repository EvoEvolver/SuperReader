import os
import dotenv
import litellm
import mllm
from fastapi import FastAPI, Request
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from pymongo import MongoClient

from tree.forest import push_tree_data
from reader.build_html_tree import build_html_tree
from reader.nature_paper_to_tree import run_nature_paper_to_tree

# Load environment variables
dotenv.load_dotenv()
client = MongoClient(os.environ.get("MONGO_URL"))

# Select database and collection
db = client["tree_gen_cache"]

# Initialize FastAPI app
app = FastAPI(title="Tree Generator API")

# Add middleware for handling forwarded headers
app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=["*"]  # Configure this appropriately in production
)

# Configure MLLM and LiteLLM
mllm.config.default_models.expensive = "gpt-4o"
api_key = os.environ.get("OPENAI_API_KEY")
forest_host = os.environ.get("FOREST_HOST", "http://localhost:29999")
admin_token = os.environ.get("FOREST_ADMIN_TOKEN")

if not all([api_key, forest_host, admin_token]):
    raise ValueError("Required environment variables are not set")

litellm.openai_key = api_key


# Pydantic models for request validation
class NatureRequest(BaseModel):
    paper_url: str
    html_source: str


class HTMLRequest(BaseModel):
    html_source: str
    file_url: str


class TreeResponse(BaseModel):
    status: str
    tree_url: str
    cached: bool


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={"error": str(exc), "status": "error"}
    )


@app.post("/generate_from_nature", response_model=TreeResponse)
async def generate_from_nature(request: NatureRequest):
    cache_collection = db["nature_papers"]
    cached_result = cache_collection.find_one({"paper_url": request.paper_url})

    if cached_result:
        return TreeResponse(
            status="success",
            tree_url=cached_result["tree_url"],
            cached=True
        )

    # Generate new tree
    doc = run_nature_paper_to_tree(request.html_source, request.paper_url)
    tree_data = doc.render_to_json()
    tree_id = push_tree_data(tree_data, forest_host, admin_token)

    # Store in cache
    cache_collection.insert_one({
        "paper_url": request.paper_url,
        "tree_url": f"{forest_host}/?id={tree_id}",
        "tree_id": tree_id,
        "tree_data": tree_data
    })

    return TreeResponse(
        status="success",
        tree_url=f"{forest_host}/?id={tree_id}",
        cached=False
    )


@app.post("/generate_from_html", response_model=TreeResponse)
async def generate_from_html(request: HTMLRequest):
    cache_collection = db["pdf_papers"]
    cached_result = cache_collection.find_one({"file_url": request.file_url})

    if cached_result:
        return TreeResponse(
            status="success",
            tree_url=cached_result["tree_url"],
            cached=True
        )

    # Generate new tree
    doc = build_html_tree(request.html_source)
    tree_data = doc.render_to_json()
    tree_id = push_tree_data(tree_data, forest_host, admin_token)
    tree_url = f"{forest_host}?id={tree_id}"
    # Store in cache
    cache_collection.insert_one({
        "html_source": request.html_source,
        "file_url": request.file_url,
        "tree_url": tree_url,
        "tree_id": tree_id,
        "tree_data": tree_data
    })

    return TreeResponse(
        status="success",
        tree_url=tree_url,
        cached=False
    )


if __name__ == '__main__':
    import uvicorn

    uvicorn.run(
        "main:app",
        host='0.0.0.0',
        port=int(os.environ.get("PORT", 8080)),
        reload=False
    )
