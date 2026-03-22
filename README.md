# OpenDashboardBIM

Open Dashboard project created on 1st BuildingSmart Porto Hackathon 2026.

## Layout

- **`frontend/`** — Open Dashboard UI (HTML, CSS, JS under `frontend/app/`), sample IFC assets, and the **dev server** that serves this folder (`dashboard_server.py`, `serve.py`).
- **`backend/`** — IFC upload/parse API only (`main.py`). Colleagues maintain this area.
- **`uploads/`** — IFC API upload scratch space.

## Run the Open Dashboard (static UI + `/api/*`)

From the repository root:

```bash
pip install -r frontend/requirements.txt
python frontend/serve.py
```

Then open `http://127.0.0.1:8000`. For a public HTTPS URL, use `python frontend/serve_public.py` (ngrok; see that file for setup).

## Run the IFC API only

From `backend/` (see `backend/README.md`):

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload
```

Server listens on port 8000 (same default port as the dashboard dev server — do not run both at once on the same port).
