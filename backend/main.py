import os
import shutil
import tempfile
import traceback

from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from ifcprocesser import process_ifc2x3
from verification import run_verification

UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "..", "uploads")
RESULTS_DIR = os.path.join(os.path.dirname(__file__), "results")
FIX_RESULTS_DIR = os.path.join(os.path.dirname(__file__), "fix results")
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(RESULTS_DIR, exist_ok=True)
os.makedirs(FIX_RESULTS_DIR, exist_ok=True)

app = FastAPI(title="IFC 2x3 Parser API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post("/upload")
async def upload_ifc(file: UploadFile = File(...)):
    if not file.filename.lower().endswith(".ifc"):
        raise HTTPException(status_code=400, detail="Only .ifc files are accepted.")

    # Save to a temp file so the parser names the JSON after the original filename
    suffix = f"_{file.filename}"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix, dir=UPLOAD_DIR) as tmp:
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

    file_path = os.path.join(RESULTS_DIR, filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found.")

    return FileResponse(file_path, media_type="application/json", filename=filename)


@app.post("/verify")
def verify_json():
    json_files = [
        f for f in os.listdir(RESULTS_DIR)
        if f.endswith(".json") and not f.endswith("_corrected.json") and f != "verification_log.json"
    ]
    if not json_files:
        raise HTTPException(status_code=404, detail="No JSON file found in results/.")

    # Use the most recently modified file
    json_files.sort(key=lambda f: os.path.getmtime(os.path.join(RESULTS_DIR, f)), reverse=True)
    json_path = os.path.join(RESULTS_DIR, json_files[0])

    try:
        result = run_verification(json_path, FIX_RESULTS_DIR)
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Verification failed: {str(e)}")

    return JSONResponse({"success": True, "input_file": json_files[0], **result})


@app.get("/health")
def health():
    return {"status": "ok"}
