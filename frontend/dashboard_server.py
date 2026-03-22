"""
REST API under /api/* and static frontend at /.

LAN / team access (same Wi‑Fi): from repo root run
  python frontend/serve.py
That binds 0.0.0.0 and prints a shareable http://<ip>:8000 URL.
"""

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

# This package directory is the static root (index.html, app/, etc.)
FRONTEND_DIR = Path(__file__).resolve().parent

app = FastAPI(
    title="Hackathon API",
    description="Backend + static frontend (FastAPI + Uvicorn)",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health():
    return {"status": "ok", "message": "API is running"}


@app.get("/api/hello")
async def hello(name: str = "hackathon"):
    return {"greeting": f"Hello, {name}!"}


@app.get("/")
async def serve_index():
    return FileResponse(FRONTEND_DIR / "index.html")


app.mount(
    "/static",
    StaticFiles(directory=str(FRONTEND_DIR)),
    name="static",
)
