# OpenDashboard — Backend

FastAPI service that accepts IFC 2x3 file uploads, parses them into structured JSON, runs data verification and correction, applies WBS (Work Breakdown Structure) codes, and serves all results to the frontend dashboard.

This service was built during the **1st BuildingSmart Porto Hackathon (2026)** and is open for community contribution.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Data Pipeline](#data-pipeline)
- [Project Structure](#project-structure)
- [Requirements & Setup](#requirements--setup)
- [Running the Server](#running-the-server)
- [API Endpoints](#api-endpoints)
- [Output JSON Structure](#output-json-structure)
- [Contributing](#contributing)

---

## Architecture Overview

```
IFC file (uploaded by user)
        │
        ▼
┌───────────────────┐
│  POST /upload     │  ← main.py
│  ifcprocesser.py  │  ← parses every IfcProduct: location, dimensions,
│                   │    materials, property sets
└────────┬──────────┘
         │  results/<model>.json
         ▼
┌───────────────────┐
│  POST /verify     │  ← verification.py
│                   │  ← checks IfcBeam/IfcColumn for missing dimensions,
│                   │    calculates weight from material density,
│                   │    writes corrected JSON + corrected IFC
└────────┬──────────┘
         │  fix results/<model>_corrected.json
         │  fix results/<model>_corrected.ifc
         ▼
┌───────────────────┐
│  POST /apply-wbs  │  ← wbs_apply.py
│                   │  ← applies user-defined WBS rules to corrected JSON
│                   │    (match by class, name, material — first rule wins)
└────────┬──────────┘
         │  fix results/<model>_corrected.json (updated in-place)
         ▼
    Frontend Dashboard
    (reads via /download endpoints)
```

The frontend communicates exclusively via the REST API — it never touches IFC files directly.

---

## Data Pipeline

### Step 1 — Upload & Parse (`ifcprocesser.py`)

Iterates every `IfcProduct` in the model and extracts:

| Field | Description |
|---|---|
| `class` | IFC class name (e.g. `IfcBeam`, `IfcColumn`) |
| `name` | Element name attribute |
| `globalId` | Unique IFC GUID |
| `location` | Project, site, storey hierarchy + global XYZ + elevations relative to storey + distance to next storey |
| `dimensions` | Length, Width, Height, Area, Volume, etc. from `IfcElementQuantity` |
| `materials` | Full material tree: `IfcMaterial`, `IfcMaterialList`, `IfcMaterialLayerSet`, layer thicknesses, and material property sets |
| `psets` | All attached property sets (`IfcPropertySet`) and quantity sets (`IfcElementQuantity`) |

Result is written to `<tmp_dir>/results/<model>.json`.

### Step 2 — Verification & Correction (`verification.py`)

Reads the parsed JSON and checks each `IfcBeam` / `IfcColumn`:

- **Dimension fixability**: if any two of `Length`, `CrossSectionArea`, `Volume` are present, the missing one is computed and added.
- **Weight calculation**: derived from `MassDensity × Volume × 9.81` (Steel/Wood) or from `Volume` alone (Concrete).

Corrected values are written back into the IFC model via `ifcopenshell.api` and the patched IFC file is saved alongside the corrected JSON.

Outputs:
- `<tmp_dir>/fix results/<model>_corrected.json`
- `<tmp_dir>/fix results/<model>_corrected.ifc`
- `<tmp_dir>/fix results/<model>_verification_log.json`

### Step 3 — WBS Assignment (`wbs_apply.py`)

Applies user-defined rules (sent from the frontend WBS table) to every object in the corrected JSON. Each rule can match on:

| Field | Meaning |
|---|---|
| `class` | IFC class, or `"All"` wildcard |
| `name` | Element name, or `"All"` wildcard |
| `material` | Comma-joined material name string, or `"All"` wildcard |
| `wbs_b` | WBS budget code |
| `wbs_e` | WBS execution code |
| `unit` | Unit of measure |

The first matching rule wins. Matched objects receive a `wbs` and `unit` field written back into the corrected JSON in-place.

---

## Project Structure

```
backend/
├── main.py            # FastAPI app — registers all endpoints, wires modules together
├── ifcprocesser.py    # Step 1: IFC parser (core data extraction logic)
├── verification.py    # Step 2: dimension/weight verification and IFC correction
├── wbs_apply.py       # Step 3: WBS rule matching and JSON annotation
├── mathutils.py       # Shared math helpers
└── requirements.txt   # Python dependencies
```

Runtime files (generated automatically, never committed):
```
<system_tmp>/imasd-runtime/
├── uploads/           # Temporary IFC file scratch space (deleted after parse)
├── results/           # Parsed JSON files from Step 1
└── fix results/       # Corrected JSON + IFC files from Steps 2 and 3
```

---

## Requirements & Setup

- Python 3.10+
- [ifcopenshell](https://ifcopenshell.org/) (install via `pip` — see note below)

```bash
pip install -r requirements.txt
```

> **Note on ifcopenshell:** Pre-built wheels are available at [https://blenderbim.org/docs-python/ifcopenshell-python/installation.html](https://blenderbim.org/docs-python/ifcopenshell-python/installation.html). If `pip install ifcopenshell` fails, download the wheel matching your Python version and OS and install it manually.

---

## Running the Server

From the `backend/` directory:

```bash
uvicorn main:app --reload
```

Server starts at `http://127.0.0.1:8000`.
Interactive API docs available at `http://127.0.0.1:8000/docs`.

> **Port conflict:** The frontend dev server (`frontend/serve.py`) also defaults to port 8000. Do not run both on the same port.

The parser can also be run standalone from the CLI (bypasses the API):

```bash
python ifcprocesser.py path/to/model.ifc
```

---

## API Endpoints

### `POST /upload`

Upload an `.ifc` file. Runs the parser and saves the result JSON.

**Request:** `multipart/form-data` with field `file` (`.ifc` only)

**Response:**
```json
{
  "success": true,
  "file": "bSH_OD_STR_01.ifc",
  "json_file": "tmp_..._bSH_OD_STR_01.json",
  "download_url": "/download/tmp_..._bSH_OD_STR_01.json",
  "total_objects": 312,
  "classes_found": { "IfcBeam": 120, "IfcColumn": 80 },
  "property_count": 54
}
```

---

### `POST /verify`

Runs verification on the most recently uploaded JSON. Corrects missing dimensions, calculates weights, and saves a corrected IFC + JSON.

**Response:**
```json
{
  "success": true,
  "input_file": "tmp_..._bSH_OD_STR_01.json",
  "corrected_json_file": "tmp_..._bSH_OD_STR_01_corrected.json",
  "corrected_ifc_file": "/tmp/imasd-runtime/fix results/tmp_..._corrected.ifc",
  "log_file": "tmp_..._bSH_OD_STR_01_verification_log.json",
  "defects_found": 12
}
```

---

### `POST /apply-wbs`

Applies WBS rules (sent in the request body) to the corrected JSON.

**Request body:**
```json
{
  "rules": [
    {
      "class": "IfcBeam",
      "name": "All",
      "material": "Concrete",
      "wbs_b": "01.02.03",
      "wbs_e": "EX.01",
      "unit": "m³"
    }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "corrected_file": "tmp_..._corrected.json",
  "matched_objects": 87,
  "total_objects": 312
}
```

---

### `GET /download/{filename}`

Download any generated JSON file by name.

**Example:** `GET /download/tmp_..._bSH_OD_STR_01.json`

---

### `GET /health`

Returns `{ "status": "ok" }`. Used by the frontend to check connectivity.

---

## Output JSON Structure

Each key is the IFC internal element ID. Example entry:

```json
{
  "123": {
    "class": "IfcBeam",
    "name": "bSH_OD_STR_01",
    "globalId": "2g8...",
    "location": {
      "project": "09",
      "site": "Default",
      "building_story": "L1.00_PisoTerreo",
      "global_x": 13.152,
      "global_y": -18.162,
      "global_z": 31.760,
      "global_bottom_elevation": 31.760,
      "global_top_elevation": 31.960,
      "bottom_elevation": -0.600,
      "top_elevation": -0.200,
      "bottom_distance_to_next_story": 3.450,
      "top_distance_to_next_story": 3.050
    },
    "dimensions": {
      "Length": 2.2,
      "CrossSectionArea": 0.06,
      "Volume": 0.132,
      "Weight": 1039.4
    },
    "materials": [
      {
        "type": "IfcMaterialLayerSet",
        "layers": [
          { "material": "Concrete", "thickness": 0.3 }
        ]
      }
    ],
    "psets": {
      "Pset_BeamCommon": {
        "LoadBearing": true,
        "FireRating": "R60"
      }
    },
    "wbs": { "b": "01.02.03", "e": "EX.01" },
    "unit": "m³"
  }
}
```

Fields `wbs` and `unit` are only present after `/apply-wbs` has been called.

---

## Contributing

Contributions are welcome! Here are the areas where the community can help most:

### Ideas for New Features

- **Support for IFC 4 / IFC 4.3** — the parser currently targets IFC 2x3; extending `ifcprocesser.py` to handle newer schemas would broaden compatibility.
- **Additional verification rules** — `verification.py` currently only checks `IfcBeam` and `IfcColumn`. Rules for slabs, walls, foundations, MEP elements, etc. would add value.
- **Clash detection** — spatial geometry overlap checks between elements.
- **Cost estimation** — connect WBS codes to unit rates to produce quantity take-offs.
- **Export formats** — generate Excel/CSV quantity schedules from the corrected JSON.
- **IFC property writing** — extend `verification.py` to patch more properties back into the IFC via `ifcopenshell.api`.
- **Async processing** — large models block the server; adding a background task queue (e.g. `asyncio` + `BackgroundTasks`) would improve scalability.

### How to Contribute

1. **Fork** the repository on GitHub.
2. Create a **feature branch**: `git checkout -b feature/my-improvement`
3. Make your changes, keeping each module focused on its responsibility:
   - Parsing logic → `ifcprocesser.py`
   - Verification / correction rules → `verification.py`
   - WBS matching logic → `wbs_apply.py`
   - New endpoints → `main.py`
4. Test your changes against a real IFC file. Sample IFC files are included in `frontend/app/assets/`.
5. Open a **pull request** with a clear description of what the change does and why.

### Conventions

- Follow the existing module structure — keep parsing, verification, and WBS concerns separated.
- New verification rules should return `(fixable: bool, defect_name: str | None, corrected_value)` tuples, consistent with the existing pattern in `verification.py`.
- New API endpoints should return `{ "success": true, ... }` JSON responses.
- Do not commit files from the `results/` or `fix results/` runtime directories.
