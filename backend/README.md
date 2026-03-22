# OpenDashboard — Backend

FastAPI service that accepts IFC 2x3 file uploads, parses them, and returns a structured JSON with object data including properties, materials, dimensions, and location information.

---

## Requirements

- Python 3.10+
- Dependencies listed in `requirements.txt`

```bash
pip install -r requirements.txt
```

---

## Running

```bash
uvicorn main:app --reload
```

Server starts at `http://127.0.0.1:8000`.
Interactive docs available at `http://127.0.0.1:8000/docs`.

---

## Endpoints

### `POST /upload`
Upload an `.ifc` file. The parser runs automatically and the JSON is saved to `backend/results/`.

**Request:** `multipart/form-data` with field `file`

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

### `GET /download/{filename}`
Download a previously generated JSON file from `backend/results/`.

**Example:** `GET /download/bSH_OD_STR_01.json`

---

### `GET /health`
Returns `{ "status": "ok" }`. Useful for health checks.

---

## Output JSON Structure

Each object in the generated JSON file has the following shape:

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
      "Width": 0.2,
      "Height": 0.3
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
    }
  }
}
```

---

## Project Structure

```
backend/
├── main.py            # FastAPI app and endpoints
├── ifcprocesser.py    # IFC 2x3 parser (core logic)
├── requirements.txt   # Python dependencies
└── results/           # Generated JSON files (auto-created)
```
