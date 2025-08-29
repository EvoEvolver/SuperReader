import os
import dotenv
import litellm
import mllm
from fastapi import FastAPI, Request
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional
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
    userid: Optional[str] = None


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
    try:
        print(f"=== Starting generate_from_html for URL: {request.file_url} ===")
        print(f"HTML source length: {len(request.html_source)} characters")
        print(f"HTML preview: {request.html_source[:200]}...")
        
        cache_collection = db["pdf_papers"]
        print("Connected to database successfully")
        
        cached_result = cache_collection.find_one({"file_url": request.file_url})
        print(f"Cache check result: {'Found' if cached_result else 'Not found'}")

        if cached_result:
            print("Returning cached result")
            return TreeResponse(
                status="success",
                tree_url=cached_result["tree_url"],
                cached=True
            )

        print("Generating new tree...")
        
        # Generate new tree
        print("Step 1: Building HTML tree...")
        doc = build_html_tree(request.html_source)
        print("Step 1: HTML tree built successfully")
        
        print("Step 2: Rendering to JSON...")
        tree_data = doc.render_to_json()
        print(f"Step 2: JSON rendered successfully, size: {len(str(tree_data))} chars")
        
        print("Step 3: Pushing tree data to forest...")
        tree_id = push_tree_data(tree_data, forest_host, admin_token, user_id=request.userid)
        tree_url = f"{forest_host}?id={tree_id}"
        print(f"Step 3: Tree pushed successfully, ID: {tree_id}")
        
        print("Step 4: Storing in cache...")
        # Store in cache
        cache_collection.insert_one({
            "html_source": request.html_source,
            "file_url": request.file_url,
            "tree_url": tree_url,
            "tree_id": tree_id,
            "tree_data": tree_data
        })
        print("Step 4: Cache stored successfully")

        print(f"=== generate_from_html completed successfully ===")
        return TreeResponse(
            status="success",
            tree_url=tree_url,
            cached=False
        )
        
    except Exception as e:
        import traceback
        error_msg = f"Error in generate_from_html: {str(e)}"
        print(f"=== ERROR: {error_msg} ===")
        print(f"Traceback: {traceback.format_exc()}")
        raise e


if __name__ == '__main__':
    import uvicorn

    uvicorn.run(
        "worker:app",
        host='0.0.0.0',
        port=int(os.environ.get("PORT", 8080)),
        reload=False
    )
