# Third-party notices

Sonora is licensed under the **GNU General Public License v3.0 or later** (see `LICENSE`).
The desktop builds bundle the following third-party software. Each component keeps its own license.

| Component | License | Source |
|---|---|---|
| FFmpeg / FFprobe (static builds) | GPL-2.0-or-later (built with `--enable-gpl`) | https://ffmpeg.org/download.html · builds: https://github.com/zackees/ffmpeg_bins |
| yt-dlp | Unlicense (public domain) | https://github.com/yt-dlp/yt-dlp |
| spotDL | MIT | https://github.com/spotDL/spotify-downloader |
| mutagen | GPL-2.0-or-later | https://github.com/quodlibet/mutagen |
| pykakasi | GPL-3.0-or-later | https://codeberg.org/miurahr/pykakasi |
| Flask, Werkzeug, Jinja2, MarkupSafe, ItsDangerous, Click | BSD-3-Clause | https://github.com/pallets |
| pywebview | BSD-3-Clause | https://github.com/r0x0r/pywebview |
| spotipy | MIT | https://github.com/spotipy-dev/spotipy |
| ytmusicapi | MIT | https://github.com/sigma67/ytmusicapi |
| rich | MIT | https://github.com/Textualize/rich |
| requests | Apache-2.0 | https://github.com/psf/requests |
| pydantic, FastAPI, rapidfuzz, platformdirs, python-slugify, beautifulsoup4, syncedlyrics, soundcloud-v2 | MIT | see each project on PyPI |
| uvicorn, websockets | BSD-3-Clause | see each project on PyPI |
| PyInstaller bootloader | GPL-2.0 with bootloader exception | https://github.com/pyinstaller/pyinstaller |
| Python | PSF License | https://www.python.org |

## FFmpeg source code

The bundled FFmpeg binaries are unmodified static builds of FFmpeg distributed under the GPL.
The corresponding source code is available from https://ffmpeg.org/releases/ (the exact version is printed by
`ffmpeg -version` inside the app bundle: `Sonora.app/Contents/Frameworks/ffmpeg/ffmpeg` on macOS,
`Sonora/_internal/ffmpeg/ffmpeg.exe` on Windows). If you can't obtain it there, open an issue on the
Sonora repository and we will provide it.

## Not affiliated

Sonora is not affiliated with, endorsed by, or sponsored by SoundCloud, Spotify, YouTube or Google.
All product names are trademarks of their respective owners and are used only to describe compatibility.
