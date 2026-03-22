# Double-click or: powershell -ExecutionPolicy Bypass -File .\serve-public.ps1
Set-Location $PSScriptRoot
python -m pip install -r requirements.txt -q 2>$null
python serve_public.py
