#!/bin/bash
# Double-click để chạy Sonora trên macOS
cd "$(dirname "$0")"
if [ ! -d .venv ]; then
  echo "Lần đầu chạy: đang cài đặt Sonora..."
  python3 -m venv .venv || { echo "Cần cài Python 3: https://www.python.org/downloads/"; read; exit 1; }
  .venv/bin/pip install -q --upgrade pip
  .venv/bin/pip install -q -r requirements.txt
fi
.venv/bin/pip install -q -U yt-dlp >/dev/null 2>&1   # yt-dlp cập nhật thường xuyên, giữ mới để không bị lỗi
.venv/bin/python app.py
