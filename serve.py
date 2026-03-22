"""
Start the app on all network interfaces (0.0.0.0) so teammates on the same Wi‑Fi
can open http://<your-laptop-ip>:PORT

Usage (from project root):
  python serve.py

Optional env:
  PORT=8000   HOST=0.0.0.0

For a public HTTPS link with ngrok, run:  python serve_public.py
(see serve_public.py for one-time token setup).
"""

from __future__ import annotations

import os
import socket

import uvicorn

# Well-known dev port; change with env PORT= if 8000 is busy
DEFAULT_PORT = 8000
HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", str(DEFAULT_PORT)))


def _guess_lan_ipv4() -> str:
    """Best-effort local IPv4 for display (UDP trick; no traffic leaves the machine)."""
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
    print("  Hackathon server (LAN + this machine)")
    print(f"  ───────────────────────────────────────")
    print(f"  This PC:  http://127.0.0.1:{PORT}")
    print(f"  Wi‑Fi/LAN: http://{lan}:{PORT}   ← share this with your team")
    print(f"  API docs: http://{lan}:{PORT}/docs")
    print(f"  Listening on {HOST}:{PORT} (all interfaces)")
    print(f"  ───────────────────────────────────────")
    print("  If others cannot connect: run open-firewall.ps1 once as Administrator.")
    print()
    uvicorn.run(
        "app.main:app",
        host=HOST,
        port=PORT,
        reload=True,
    )
