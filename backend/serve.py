"""
Start the dashboard (API + static frontend) on all interfaces (0.0.0.0).

Usage from repo root:
  python backend/serve.py

Optional env:
  PORT=8000   HOST=0.0.0.0

For a public HTTPS link with ngrok, run:  python backend/serve_public.py
"""

from __future__ import annotations

import os
import socket
import sys
from pathlib import Path

import uvicorn

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

DEFAULT_PORT = 8000
HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", str(DEFAULT_PORT)))


def _guess_lan_ipv4() -> str:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0.25)
        s.connect(("203.0.113.1", 1))
        ip = s.getsockname()[0]
    except OSError:
        ip = "127.0.0.1"
    finally:
        s.close()
    return ip


if __name__ == "__main__":
    lan = _guess_lan_ipv4()
    print()
    print("  Open Dashboard server (LAN + this machine)")
    print(f"  ───────────────────────────────────────")
    print(f"  This PC:  http://127.0.0.1:{PORT}")
    print(f"  Wi‑Fi/LAN: http://{lan}:{PORT}   ← share this with your team")
    print(f"  API docs: http://{lan}:{PORT}/docs")
    print(f"  Listening on {HOST}:{PORT} (all interfaces)")
    print(f"  ───────────────────────────────────────")
    print("  If others cannot connect: run backend/open-firewall.ps1 once as Administrator.")
    print()
    uvicorn.run(
        "backend.dashboard_server:app",
        host=HOST,
        port=PORT,
        reload=True,
    )
