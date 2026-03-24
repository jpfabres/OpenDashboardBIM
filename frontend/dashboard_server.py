"""
REST API under /api/* and static frontend at /.

LAN / team access (same Wi‑Fi): from repo root run
  python frontend/serve.py
That binds 0.0.0.0 and prints a shareable http://<ip>:8000 URL.
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import traceback
from pathlib import Path

from fastapi import FastAPI, File, UploadFile, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

# Make sure the backend module is importable
BACKEND_DIR = Path(__file__).resolve().parent.parent / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

RUNTIME_DATA_DIR = Path(tempfile.gettempdir()) / "imasd-runtime"
UPLOAD_DIR = RUNTIME_DATA_DIR / "uploads"
RESULTS_DIR = RUNTIME_DATA_DIR / "results"
FIX_RESULTS_DIR = RUNTIME_DATA_DIR / "fix results"
REPORTS_DIR = RUNTIME_DATA_DIR / "reports"
os.environ["IFC_RESULTS_DIR"] = str(RESULTS_DIR)

from ifcprocesser import process_ifc2x3  # noqa: E402
from verification import run_verification  # noqa: E402
from wbs_apply import apply_wbs  # noqa: E402

UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
RESULTS_DIR.mkdir(parents=True, exist_ok=True)
FIX_RESULTS_DIR.mkdir(parents=True, exist_ok=True)
REPORTS_DIR.mkdir(parents=True, exist_ok=True)

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
        os.remove(ifc_path)
        raise HTTPException(status_code=500, detail=f"Failed to parse IFC file: {str(e)}")

    return JSONResponse({
        "success": True,
        "file": file.filename,
        "json_file": os.path.basename(json_path),
        "download_url": f"/download/{os.path.basename(json_path)}",
        "total_objects": result["total_objects"],
        "classes_found": result["classes_found"],
        "property_count": len(result["psets_found"]),
    })


def _latest_results_json_path():
    """Same selection rule as POST /verify: newest non-corrected JSON in results/."""
    json_files = [
        f
        for f in os.listdir(str(RESULTS_DIR))
        if f.endswith(".json") and not f.endswith("_corrected.json") and f != "verification_log.json"
    ]
    if not json_files:
        return None
    json_files.sort(key=lambda f: os.path.getmtime(str(RESULTS_DIR / f)), reverse=True)
    return RESULTS_DIR / json_files[0]

def _latest_verification_log_path():
    """Newest verification log in fix results/ (supports legacy + per-model naming)."""
    candidates = [p for p in FIX_RESULTS_DIR.iterdir() if p.is_file() and p.name.endswith("_verification_log.json")]
    canonical = FIX_RESULTS_DIR / "verification_log.json"
    if canonical.is_file():
        candidates.append(canonical)
    if not candidates:
        return None
    candidates.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return candidates[0]

def _latest_corrected_ifc_path():
    """Newest corrected IFC in fix results/ (output of Fix Quantities)."""
    candidates = [
        p for p in FIX_RESULTS_DIR.iterdir()
        if p.is_file() and p.name.endswith("_corrected.ifc")
    ]
    if not candidates:
        return None
    candidates.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return candidates[0]


def _latest_corrected_json_path():
    """Newest corrected JSON in fix results/ (output of Fix Quantities)."""
    candidates = [
        p for p in FIX_RESULTS_DIR.iterdir()
        if p.is_file() and p.name.endswith("_corrected.json")
    ]
    if not candidates:
        return None
    candidates.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return candidates[0]


def _aggregate_ifc_health(results_path: Path) -> dict:
    """
    Class totals from the exported IFC JSON; fix counts from fix results/verification_log.json
    (output of Fix Quantities). Attribute counts are defect occurrences per attribute name.
    """
    with open(results_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    class_totals: dict[str, int] = {}
    for value in data.values():
        if not isinstance(value, dict):
            continue
        cls = value.get("class")
        if isinstance(cls, str) and cls:
            class_totals[cls] = class_totals.get(cls, 0) + 1

    def _consideration_states(rec: dict) -> list[bool | None]:
        """
        Collect all tri-state consideration values that appear before "Attributes".
        This keeps aggregation forward-compatible with new consideration fields.
        """
        states: list[bool | None] = []
        for key, val in rec.items():
            if key == "Attributes":
                break
            if val is True or val is False or val is None:
                states.append(val)
        return states

    def _overall_state(rec: dict) -> bool | None | str:
        """
        Return combined object state:
        - True: at least one consideration fixed
        - False: no fixed consideration, but at least one not-fixable
        - None: all considerations clean (null)
        - "unknown": no recognizable consideration states
        """
        states = _consideration_states(rec)
        if not states:
            return "unknown"
        if any(s is True for s in states):
            return True
        if any(s is False for s in states):
            return False
        return None

    log_path = _latest_verification_log_path()
    fixed_per_class: dict[str, int] = {}
    unfixable_per_class: dict[str, int] = {}
    attr_counts: dict[str, int] = {}
    fixed_objects = 0
    clean_objects = 0
    not_fixable_objects = 0
    if log_path and log_path.exists():
        with open(log_path, "r", encoding="utf-8") as f:
            log = json.load(f)
        for cls, entries in log.items():
            if not isinstance(entries, list):
                continue
            for entry in entries:
                if not isinstance(entry, dict):
                    continue
                for _gid, rec in entry.items():
                    if not isinstance(rec, dict):
                        continue
                    fixable = _overall_state(rec)
                    attrs = rec.get("Attributes")
                    if fixable is True:
                        fixed_per_class[cls] = fixed_per_class.get(cls, 0) + 1
                        fixed_objects += 1
                    elif fixable is False:
                        unfixable_per_class[cls] = unfixable_per_class.get(cls, 0) + 1
                        not_fixable_objects += 1
                    elif fixable is None:
                        clean_objects += 1
                    if not isinstance(attrs, list):
                        continue
                    for a in attrs:
                        if isinstance(a, str) and a:
                            attr_counts[a] = attr_counts.get(a, 0) + 1

    total_objects = sum(class_totals.values())

    by_class = []
    for cls, total in sorted(class_totals.items(), key=lambda x: (-x[1], x[0])):
        raw_fixed = fixed_per_class.get(cls, 0)
        raw_unfixable = unfixable_per_class.get(cls, 0)
        # Log may be from a different run than the newest results JSON — avoid % > 100.
        fixed = min(raw_fixed, total)
        unfixable = min(raw_unfixable, max(0, total - fixed))
        issue_count = fixed + unfixable
        pct = round(100.0 * fixed / total, 1) if total else 0.0
        by_class.append({
            "class": cls,
            "total": total,
            "fixed": fixed,
            "unfixable": unfixable,
            "issue_count": issue_count,
            "pct_fixed": pct,
        })

    total_fixed_objects = fixed_objects

    total_attr_defects = sum(attr_counts.values())
    by_attribute = []
    for name, count in sorted(attr_counts.items(), key=lambda x: (-x[1], x[0])):
        pct = round(100.0 * count / total_attr_defects, 1) if total_attr_defects else 0.0
        by_attribute.append({
            "attribute": name,
            "count": count,
            "pct_of_fixes": pct,
        })

    return {
        "json_file": results_path.name,
        "totals": {
            "objects": total_objects,
            "fixed_objects": total_fixed_objects,
            "clean_objects": clean_objects,
            "not_fixable_objects": not_fixable_objects,
            "has_verification_log": bool(log_path and log_path.exists()),
        },
        "by_class": by_class,
        "by_attribute": by_attribute,
    }


def _clear_all_files_in_dir(directory: Path) -> list[str]:
    """Remove all regular files in *directory* (non-recursive). Returns basenames removed."""
    removed: list[str] = []
    if not directory.is_dir():
        return removed
    for entry in directory.iterdir():
        if entry.is_file():
            try:
                entry.unlink()
                removed.append(entry.name)
            except OSError:
                traceback.print_exc()
    return removed


@app.post("/api/ifc-reset")
def ifc_reset():
    """
    Clear Fix Quantities outputs (backend/fix results/*) and exported IFC JSON
    (backend/results/*.json) so the session matches an empty dashboard state.
    """
    try:
        removed_fix = _clear_all_files_in_dir(FIX_RESULTS_DIR)
        removed_results: list[str] = []
        for entry in RESULTS_DIR.iterdir():
            if entry.is_file() and entry.suffix.lower() == ".json":
                try:
                    entry.unlink()
                    removed_results.append(entry.name)
                except OSError:
                    traceback.print_exc()
        return JSONResponse({
            "success": True,
            "removed_fix_results": removed_fix,
            "removed_results": removed_results,
        })
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"IFC reset failed: {str(e)}") from e


@app.get("/api/ifc-verification-log")
def ifc_verification_log():
    """Fix Quantities log (used client-side to refine charts when element filters are active)."""
    log_path = _latest_verification_log_path()
    if not log_path or not log_path.is_file():
        return JSONResponse({})
    try:
        with open(log_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return JSONResponse(data if isinstance(data, dict) else {})
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Could not read verification log: {str(e)}") from e


@app.get("/api/fix-quantities-ifc")
def latest_fix_quantities_ifc():
    """Download latest corrected IFC generated by Fix Quantities."""
    ifc_path = _latest_corrected_ifc_path()
    if not ifc_path or not ifc_path.is_file():
        raise HTTPException(
            status_code=404,
            detail="No corrected IFC found. Run Fix Quantities first.",
        )
    return FileResponse(
        str(ifc_path),
        media_type="application/octet-stream",
        filename=ifc_path.name,
    )


@app.get("/api/fix-quantities-corrected-json")
def latest_fix_quantities_corrected_json():
    """Download latest corrected JSON generated by Fix Quantities."""
    json_path = _latest_corrected_json_path()
    if not json_path or not json_path.is_file():
        raise HTTPException(
            status_code=404,
            detail="No corrected JSON found. Run Fix Quantities first.",
        )
    return FileResponse(
        str(json_path),
        media_type="application/json",
        filename=json_path.name,
    )


@app.get("/api/fix-quantities-corrected-json/{filename}")
def fix_quantities_corrected_json_by_name(filename: str):
    """Download a specific corrected JSON by filename from fix results/."""
    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Invalid filename.")
    file_path = FIX_RESULTS_DIR / filename
    if not file_path.is_file() or not filename.endswith("_corrected.json"):
        raise HTTPException(status_code=404, detail="Corrected JSON not found.")
    return FileResponse(
        str(file_path),
        media_type="application/json",
        filename=file_path.name,
    )


@app.get("/api/ifc-health-stats")
def ifc_health_stats():
    """Aggregates class distribution + Fix Quantities verification_log for IFC Health charts."""
    path = _latest_results_json_path()
    if not path:
        return JSONResponse({
            "ok": False,
            "detail": "No IFC JSON in backend/results — upload an .ifc first.",
            "json_file": None,
            "totals": {"objects": 0, "fixed_objects": 0, "has_verification_log": False},
            "by_class": [],
            "by_attribute": [],
        })
    try:
        payload = _aggregate_ifc_health(path)
        return JSONResponse({"ok": True, **payload})
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"IFC health aggregation failed: {str(e)}") from e


@app.post("/api/reports/ifc-health-3d-pdf")
def export_ifc_health_3d_pdf():
    """
    Experimental server-side 3D PDF export.
    Requires env var IFC_3D_PDF_COMMAND with placeholders:
      {results_json}, {verification_log}, {output_pdf}
    """
    results_path = _latest_results_json_path()
    if not results_path:
        raise HTTPException(status_code=404, detail="No IFC JSON in backend/results — upload an .ifc first.")

    verification_log = _latest_verification_log_path()
    command_templates = [
        os.environ.get("IFC_3D_PDF_COMMAND", "").strip(),
        os.environ.get("IFC_3D_PDF_FALLBACK_COMMAND", "").strip(),
    ]
    command_templates = [c for c in command_templates if c]
    if not command_templates:
        return JSONResponse(
            status_code=501,
            content={
                "success": False,
                "detail": (
                    "3D PDF exporter is not configured on the server. "
                    "Set IFC_3D_PDF_COMMAND (and optionally IFC_3D_PDF_FALLBACK_COMMAND) "
                    "to enable this experimental option."
                ),
                "expected_placeholders": ["{results_json}", "{verification_log}", "{output_pdf}"],
            },
        )

    output_name = f"{results_path.stem}_ifc_health_3d_report.pdf"
    output_pdf = REPORTS_DIR / output_name
    if output_pdf.exists():
        try:
            output_pdf.unlink()
        except OSError:
            traceback.print_exc()

    last_error = ""
    for idx, command_template in enumerate(command_templates):
        try:
            command = command_template.format(
                results_json=str(results_path),
                verification_log=str(verification_log) if verification_log else "",
                output_pdf=str(output_pdf),
            )
        except Exception as e:
            last_error = f"Invalid 3D PDF command template #{idx + 1}: {str(e)}"
            continue

        try:
            proc = subprocess.run(
                command,
                shell=True,
                capture_output=True,
                text=True,
                timeout=300,
                cwd=str(BACKEND_DIR),
            )
        except subprocess.TimeoutExpired as e:
            last_error = f"3D PDF exporter timed out on command #{idx + 1}: {str(e)}"
            continue
        except Exception as e:
            traceback.print_exc()
            last_error = f"3D PDF exporter failed to start on command #{idx + 1}: {str(e)}"
            continue

        if proc.returncode == 0 and output_pdf.exists():
            return FileResponse(str(output_pdf), media_type="application/pdf", filename=output_name)

        stderr = (proc.stderr or "").strip()
        stdout = (proc.stdout or "").strip()
        out = stderr or stdout
        if proc.returncode != 0:
            last_error = f"3D PDF exporter failed on command #{idx + 1} (code {proc.returncode}): {out[:500]}"
        elif not output_pdf.exists():
            last_error = f"3D PDF exporter command #{idx + 1} ended without creating output file."

    raise HTTPException(status_code=500, detail=last_error or "3D PDF export failed.")


@app.post("/verify")
def verify_json():
    json_files = [
        f for f in os.listdir(str(RESULTS_DIR))
        if f.endswith(".json") and not f.endswith("_corrected.json") and f != "verification_log.json"
    ]
    if not json_files:
        raise HTTPException(status_code=404, detail="No JSON file found in results/.")

    json_files.sort(key=lambda f: os.path.getmtime(str(RESULTS_DIR / f)), reverse=True)
    json_path = str(RESULTS_DIR / json_files[0])

    # Find the IFC file in UPLOAD_DIR that matches the JSON model name.
    # JSON name: tmpABC_bSH_OD_STR_01.json → model name: bSH_OD_STR_01
    json_stem = Path(json_files[0]).stem
    parts = json_stem.split("_", 1)
    model_name = parts[1] if len(parts) > 1 else json_stem
    ifc_candidates = sorted(
        [f for f in UPLOAD_DIR.iterdir() if f.suffix.lower() == ".ifc" and model_name in f.stem],
        key=lambda f: f.stat().st_mtime,
        reverse=True,
    )
    if not ifc_candidates:
        raise HTTPException(status_code=404, detail=f"IFC file for model '{model_name}' not found in uploads.")
    ifc_path = str(ifc_candidates[0])

    try:
        result = run_verification(json_path, ifc_path, str(FIX_RESULTS_DIR))
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Verification failed: {str(e)}")

    return JSONResponse({"success": True, "input_file": json_files[0], **result})


@app.get("/download/{filename}")
def download_json(filename: str):
    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Invalid filename.")
    file_path = RESULTS_DIR / filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found.")
    return FileResponse(str(file_path), media_type="application/json", filename=filename)


@app.post("/api/wbs-apply")
async def wbs_apply_endpoint(request: Request):
    """Apply WBS codes from the mapping table to the latest _corrected.json."""
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body.")
    rules = payload.get("rules", [])
    if not isinstance(rules, list):
        raise HTTPException(status_code=400, detail="'rules' must be a list.")
    try:
        result = apply_wbs(str(FIX_RESULTS_DIR), rules)
        return JSONResponse({"success": True, **result})
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"WBS apply failed: {str(e)}") from e


@app.get("/")
async def serve_index():
    return FileResponse(FRONTEND_DIR / "index.html")


app.mount(
    "/static",
    StaticFiles(directory=str(FRONTEND_DIR)),
    name="static",
)
