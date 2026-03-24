# OpenDashboardBIM

An open-source BIM dashboard created at the **1st BuildingSmart Porto Hackathon (2026)**.

Upload an IFC model, automatically verify and correct element data, assign WBS codes, and visualize everything in an interactive web dashboard — no proprietary software required.

---

## What it does

1. **Upload** an IFC 2x3 or a IFC 4 file through the dashboard.
2. **Parse** — every `IfcProduct` is extracted into structured JSON (location, dimensions, materials, property sets).
3. **Verify & Correct** — missing dimensions on beams/columns are computed from related quantities; element weights are derived from material density; a corrected IFC file is produced.
4. **WBS Assignment** — user-defined rules map IFC elements to Work Breakdown Structure codes and units of measure.
5. **Visualize** — charts show element class distribution, data quality health, and quantity take-offs, all driven by the processed JSON.

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                  Browser (frontend/app/)                  │
│  HTML · CSS · Vanilla JS                                 │
│  ifc-viewer.js · ifc-health.js · ifc-element-filters.js  │
└───────────────────────┬──────────────────────────────────┘
                        │  REST API calls
┌───────────────────────▼──────────────────────────────────┐
│           FastAPI server  (frontend/dashboard_server.py)  │
│                                                          │
│  /upload          → backend/ifcprocesser.py              │
│  /verify          → backend/verification.py              │
│  /api/wbs-apply   → backend/wbs_apply.py                 │
│  /api/ifc-health* → aggregation helpers (dashboard_server)│
│  /static/*        → serves frontend/app/ files           │
└──────────────────────────────────────────────────────────┘
                        │  writes/reads
┌───────────────────────▼──────────────────────────────────┐
│           <system_tmp>/imasd-runtime/                    │
│  uploads/          temporary IFC scratch (auto-deleted)  │
│  results/          parsed JSON (Step 1)                  │
│  fix results/      corrected JSON + IFC (Steps 2 & 3)    │
│  reports/          exported PDFs (experimental)          │
└──────────────────────────────────────────────────────────┘
```

The full stack is served by a single Python process. The backend modules (`ifcprocesser`, `verification`, `wbs_apply`) are imported directly by the dashboard server — no separate backend process is needed for normal use.

---

## Project Structure

```
OpenDashboard/
│
├── frontend/
│   ├── dashboard_server.py   # FastAPI app: API routes + static file serving
│   ├── serve.py              # Entry point — starts uvicorn on all interfaces
│   ├── serve_public.py       # Ngrok variant for a public HTTPS URL
│   ├── requirements.txt      # Python dependencies for the full stack
│   └── app/
│       ├── index.html
│       ├── app.js            # Main dashboard logic
│       ├── ifc-viewer.js     # IFC element explorer / table
│       ├── ifc-health.js     # Data quality charts
│       ├── ifc-element-filters.js  # Filter / search UI
│       ├── styles.css
│       └── assets/           # Sample IFC files for testing
│
└── backend/
    ├── ifcprocesser.py       # Step 1: IFC parser (core extraction logic)
    ├── verification.py       # Step 2: dimension/weight verification + IFC correction
    ├── wbs_apply.py          # Step 3: WBS rule matching and JSON annotation
    ├── mathutils.py          # Shared math helpers
    ├── main.py               # Standalone FastAPI app (backend only, for development)
    └── requirements.txt      # Backend-only dependencies
```

---

## Quickstart

### Run the full dashboard (recommended)

Requires Python 3.10+. From the repository root:

```bash
pip install -r frontend/requirements.txt
python frontend/serve.py
```

Open `http://127.0.0.1:8000` in your browser.

The server also binds on all network interfaces — a LAN URL is printed at startup so teammates on the same Wi-Fi can access the dashboard directly.

> **Windows firewall:** if others cannot reach the LAN URL, run `frontend/open-firewall.ps1` once as Administrator.

### Share a public HTTPS link (ngrok)

```bash
python frontend/serve_public.py
```

See that file for ngrok setup instructions.

### Run the backend API standalone (development)

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload
```

Interactive API docs at `http://127.0.0.1:8000/docs`.

> Do not run both the dashboard server and the standalone backend on the same port.

---

## Using the Dashboard

| Step | UI action | What happens |
|---|---|---|
| 1 | Upload `.ifc` file | File is parsed; all elements appear in the table |
| 2 | Click **Fix Quantities** | Verification runs; missing dimensions/weights are computed; corrected IFC is saved |
| 3 | Fill the **WBS table** and click **Apply WBS** | WBS codes and units are written into the corrected JSON |
| 4 | Browse **IFC Health** charts | Charts show element class breakdown and data quality statistics |
| 5 | Use filters / search | Narrow the element table by class, storey, material, or property value |

Sample IFC files for testing are in `frontend/app/assets/`.

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8000` | Port the server listens on |
| `HOST` | `0.0.0.0` | Bind address |
| `IFC_3D_PDF_COMMAND` | _(unset)_ | Shell command template for experimental 3D PDF export; placeholders: `{results_json}`, `{verification_log}`, `{output_pdf}` |
| `IFC_3D_PDF_FALLBACK_COMMAND` | _(unset)_ | Second command tried if the primary fails |

---

## Contributing

This project is open and was built in a hackathon sprint — there is plenty of room to grow. Contributions of any size are welcome.

### Good first areas

- **IFC 4 / IFC 4.3 support** — the parser targets IFC 2x3; broadening schema support in `ifcprocesser.py` would help most real-world projects.
- **More verification rules** — `verification.py` currently checks beams and columns. Slabs, walls, MEP elements, foundations, and more could follow the same pattern.
- **Clash detection** — spatial geometry overlap checks between elements.
- **Quantity take-off export** — generate an Excel or CSV schedule from the WBS-annotated JSON.
- **Cost estimation** — connect WBS codes to unit rates.
- **Frontend charts** — additional visualisations in `ifc-health.js` or `app.js`.
- **Async processing** — large models block the server; a task queue would improve scalability for heavy files.
- **Tests** — there are no automated tests yet; unit tests for the parser and verification logic would be a great addition.

### How to contribute

1. Fork the repository.
2. Create a feature branch: `git checkout -b feature/my-improvement`
3. Keep concerns separated:
   - Parsing logic → `backend/ifcprocesser.py`
   - Verification / correction rules → `backend/verification.py`
   - WBS matching logic → `backend/wbs_apply.py`
   - New API routes → `frontend/dashboard_server.py`
   - UI → `frontend/app/`
4. Test against a real IFC file. Sample files are in `frontend/app/assets/`.
5. Open a pull request with a clear description of what the change does and why.

See [backend/README.md](backend/README.md) for a detailed breakdown of the backend pipeline, data structures, and API reference.

---

## License

This project was created at a public hackathon and is open for community use and contribution.
