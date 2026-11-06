# Sonora

**A local-first music player.** Import music from files, folders or links (SoundCloud, Spotify, YouTube, Bandcamp…), **keep the source quality**, and manage your whole library on your own device.

> Sonora is not an online service: no account, no server. Your music lives in a folder you choose.

**Website:** https://levidang306.github.io/sonora/

## Features

- **Import preview**: paste a link, see the track list, **listen to the exact stream that will be downloaded**, and pick tracks before downloading
- **Honest quality badges**: every track shows the *actual* quality of its source
  - 🟢 lossless / original file (`FLAC 24-bit`, `WAV Original`)
  - 🟡 compressed but good (`AAC 160k`, `Opus 129k`, `MP3 320k`)
  - 🔴 low or unknown
- **No automatic conversion**: the default *Original* mode keeps the best stream the source offers. If you convert a compressed source to FLAC/WAV, Sonora warns you that it **won't sound better**, and the badge still says `from AAC 160k`
- Prefers the artist's original file when downloads are enabled on SoundCloud
- Spotify: reads metadata and cover art from Spotify, finds the matching track on YouTube Music, and warns when the durations differ (it may be a different version)
- Local library (SQLite): All music, Favorites, Recently added, Playlists, Local folders, search, filter by quality
- Player: queue, shuffle, repeat, keyboard shortcuts, OS media keys
- Drag and drop files or folders: copied as-is, never converted
- Downloads can be cancelled at any time; existing files are never overwritten
- Update the download engine (yt-dlp) from inside the app, without reinstalling

## Download

Get the latest build from [Releases](../../releases/latest):

| OS | File |
|---|---|
| macOS Apple Silicon (M1–M4) | `Sonora-macOS-arm64.zip` |
| macOS Intel | `Sonora-macOS-x64.zip` |
| Windows 10/11 | `Sonora-Windows-x64.zip` |

The app is **not code-signed yet**, so your OS will warn you the first time you open it:

- **macOS:** unzip, drag `Sonora.app` into Applications, open it → when it's blocked, go to **System Settings → Privacy & Security → Open Anyway**.
  Or run: `xattr -dr com.apple.quarantine /Applications/Sonora.app`
- **Windows:** unzip and run `Sonora.exe` → SmartScreen → **More info → Run anyway**. Requires WebView2 (preinstalled on Windows 10/11).

Default library folder: `~/Music/Sonora` (change it in Settings). App data: `~/.sonora/`.

## Run from source

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python app.py            # opens in your browser at http://127.0.0.1:5050
```

For a native window: `pip install pywebview`, then `python desktop.py`.
Or double-click `start-mac.command` / `start-windows.bat`.

## Build

```bash
pip install -r requirements.txt -r packaging/requirements-build.txt
python packaging/build.py          # -> dist/Sonora-<os>-<arch>.zip
python packaging/smoke_test.py
```

Pushing a `vX.Y.Z` tag (it must match `VERSION` in `app.py`) makes GitHub Actions build macOS arm64/x64 and Windows x64, run a smoke test, and publish a Release.

## ⚠️ Legal use

Sonora is a music player. The import-from-link feature is **only for content you own or have permission to download**: your own music, Creative Commons music, or tracks whose artists have enabled downloads.
Downloading copyrighted music without permission may violate copyright law where you live and the terms of service of SoundCloud, YouTube and Spotify. You are responsible for how you use this software.

Sonora **does not circumvent DRM**: for Spotify links, it only reads public metadata from Spotify and looks up the matching track on YouTube Music.
Sonora is not affiliated with, sponsored by, or endorsed by SoundCloud, Spotify, YouTube or Google.

## License

[GPL-3.0-or-later](LICENSE). Third-party components: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
Built on [yt-dlp](https://github.com/yt-dlp/yt-dlp), [spotDL](https://github.com/spotDL/spotify-downloader), [mutagen](https://github.com/quodlibet/mutagen), [FFmpeg](https://ffmpeg.org), [Flask](https://flask.palletsprojects.com) and [pywebview](https://pywebview.flowrl.com).
