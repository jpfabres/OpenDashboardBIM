"""
Run the dashboard (API + static frontend) and expose it with ngrok (HTTPS public URL).

Prerequisite (one-time):
  1. Create a free account at https://dashboard.ngrok.com/signup
  2. Copy your authtoken from https://dashboard.ngrok.com/get-started/your-authtoken
  3. Run once in a terminal:
       ngrok config add-authtoken YOUR_TOKEN_HERE
     Or set environment variable NGROK_AUTHTOKEN to that token (no spaces).

From repo root:
  pip install -r backend/requirements.txt
  python backend/serve_public.py

Share the printed "PUBLIC URL" with anyone; it works outside your Wi‑Fi.
Reload is disabled here so the process stays stable with the tunnel.
"""

from __future__ import annotations

import atexit
import os
import socket
import sys
from pathlib import Path

import uvicorn
from pyngrok import conf, ngrok
from pyngrok.exception import PyngrokError

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

DEFAULT_PORT = 8000
HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", str(DEFAULT_PORT)))

_authtoken = os.environ.get("NGROK_AUTHTOKEN")
if _authtoken:
    conf.get_default().auth_token = _authtoken


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


def main() -> None:
    lan = _guess_lan_ipv4()

    try:
        tunnel = ngrok.connect(PORT, "http")
        public_url = tunnel.public_url
    except PyngrokError as e:
        print()
        print("  ngrok could not start the tunnel.")
        print("  One-time setup: https://dashboard.ngrok.com/get-started/your-authtoken")
        print("  Then either:")
        print('    ngrok config add-authtoken "<your token>"')
        print("  or set environment variable NGROK_AUTHTOKEN to that token.")
        print()
        print(f"  Details: {e}")
        print()
        raise SystemExit(1) from e

    def _shutdown_tunnel() -> None:
        try:
            ngrok.disconnect(public_url)
        except Exception:
            pass
        try:
            ngrok.kill()
        except Exception:
            pass

    atexit.register(_shutdown_tunnel)

    print()
    print("  Open Dashboard — public via ngrok")
    print(f"  ───────────────────────────────────────")
    print(f"  PUBLIC URL (share this):  {public_url}")
    print(f"  ───────────────────────────────────────")
    print(f"  This PC:    http://127.0.0.1:{PORT}")
    print(f"  LAN:        http://{lan}:{PORT}")
    print(f"  API docs:   {public_url}/docs")
    print(f"  Listening:  {HOST}:{PORT}")
    print()
    print("  Ctrl+C stops the server and closes the tunnel.")
    print()

    uvicorn.run(
        "backend.dashboard_server:app",
        host=HOST,
        port=PORT,
        reload=False,
    )


if __name__ == "__main__":
    main()
