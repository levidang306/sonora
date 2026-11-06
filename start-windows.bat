@echo off
REM Double-click de chay Sonora tren Windows
cd /d "%~dp0"
if not exist .venv (
  echo Lan dau chay: dang cai dat...
  python -m venv .venv || (echo Can cai Python 3 tu https://www.python.org/downloads/ ^(tick "Add to PATH"^) & pause & exit /b 1)
  .venv\Scripts\python -m pip install -q --upgrade pip
  .venv\Scripts\pip install -q -r requirements.txt
)
.venv\Scripts\pip install -q -U yt-dlp >nul 2>&1
.venv\Scripts\python app.py
pause
