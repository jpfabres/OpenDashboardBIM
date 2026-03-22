"""
REST API under /api/* and static frontend at /.

LAN / team access (same Wi‑Fi): from repo root run
  python frontend/serve.py
That binds 0.0.0.0 and prints a shareable http://<ip>:8000 URL.
"""

import os
import shutil
import sys
import tempfile
import traceback
from pathlib import Path

from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

# Make sure the backend module is importable
BACKEND_DIR = Path(__file__).resolve().parent.parent / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from ifcprocesser import process_ifc2x3  # noqa: E402

UPLOAD_DIR = BACKEND_DIR / "uploads"
RESULTS_DIR = BACKEND_DIR / "results"
UPLOAD_DIR.mkdir(exist_ok=True)
RESULTS_DIR.mkdir(exist_ok=True)

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


@app.post("/upload")
async def upload_ifc(file: UploadFile = File(...)):
    if not file.filename.lower().endswith(".ifc"):
        raise HTTPException(status_code=400, detail="Only .ifc files are accepted.")

    suffix = f"_{file.filename}"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix, dir=str(UPLOAD_DIR)) as tmp:
        shutil.copyfileobj(file.file, tmp)
        ifc_path = tmp.name

    try:
        json_path, result = process_ifc2x3(ifc_path)
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Failed to parse IFC file: {str(e)}")
    finally:
        if os.path.exists(ifc_path):
            os.remove(ifc_path)

    return JSONResponse({
        "success": True,
        "file": file.filename,
        "json_file": os.path.basename(json_path),
        "download_url": f"/download/{os.path.basename(json_path)}",
        "total_objects": result["total_objects"],
        "classes_found": result["classes_found"],
        "property_count": len(result["psets_found"]),
    })


@app.get("/download/{filename}")
def download_json(filename: str):
    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Invalid filename.")
    file_path = RESULTS_DIR / filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found.")
    return FileResponse(str(file_path), media_type="application/json", filename=filename)


@app.get("/")
async def serve_index():
    return FileResponse(FRONTEND_DIR / "index.html")


app.mount(
    "/static",
    StaticFiles(directory=str(FRONTEND_DIR)),
    name="static",
)
