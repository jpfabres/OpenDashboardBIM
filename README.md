# OpenDashboardBIM

Open Dashboard project created on 1st BuildingSmart Porto Hackathon 2026.

## Layout

- **`frontend/`** — Open Dashboard UI (HTML, CSS, JS) and sample IFC assets under `frontend/assets/`.
- **`backend/`** — Python services: IFC upload/parse API (`main.py`) and optional dashboard dev server that serves `frontend/` (`dashboard_server.py`).

## Run the dashboard (static UI + `/api/*`)

From the repository root:

```bash
pip install -r backend/requirements.txt
python backend/serve.py
```

Then open `http://127.0.0.1:8000`. For a public HTTPS URL, use `python backend/serve_public.py` (ngrok; see that file for setup).

## Run the IFC API only

From `backend/` (see `backend/README.md`):

```bash
cd backend
uvicorn main:app --reload
```
