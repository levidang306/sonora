"""Chạy bản build ở chế độ headless và kiểm tra server + ffmpeg đóng gói kèm. Dùng trong CI."""
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
exe = ROOT / "dist" / ("Sonora/Sonora.exe" if os.name == "nt" else "Sonora.app/Contents/MacOS/Sonora")
tmp = Path(tempfile.mkdtemp())
env = dict(os.environ, SONORA_HEADLESS="1", SONORA_PORT="5077", SONORA_DATA=str(tmp / "data"), SONORA_STORAGE=str(tmp / "lib"))
proc = subprocess.Popen([str(exe)], env=env)
try:
    for _ in range(180):
        try:
            state = json.load(urllib.request.urlopen("http://127.0.0.1:5077/api/state", timeout=2))
            break
        except Exception:
            if proc.poll() is not None:
                sys.exit(f"app exited with code {proc.returncode}")
            time.sleep(1)
    else:
        sys.exit("server did not start")
    page = urllib.request.urlopen("http://127.0.0.1:5077/", timeout=5).read()
    assert b"Sonora" in page, "index.html missing"
    assert urllib.request.urlopen("http://127.0.0.1:5077/static/app.js", timeout=5).status == 200
    assert state["ffmpeg"], "bundled ffmpeg not found"
    print("smoke test OK:", {k: state[k] for k in ("version", "engine", "ffmpeg")})
finally:
    proc.kill()
