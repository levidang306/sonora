"""Sonora — local-first music player + importer.

Chạy:  python app.py   -> mở http://127.0.0.1:5050
"""
from __future__ import annotations

import base64
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import threading
import time
import urllib.request
import uuid
import webbrowser
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

# ---- download engine: ưu tiên bản yt-dlp mới hơn do người dùng cập nhật (~/.sonora/engine/yt-dlp.zip)
_DATA = Path(os.environ.get("SONORA_DATA", Path.home() / ".sonora"))
ENGINE_ZIP = _DATA / "engine" / "yt-dlp.zip"
if ENGINE_ZIP.is_file() and os.environ.get("SONORA_NO_ENGINE") != "1":
    from importlib.machinery import PathFinder

    class _EngineFinder:
        """Cho yt_dlp nạp từ zip cập nhật, kể cả khi app đã được đóng gói bằng PyInstaller."""

        @staticmethod
        def find_spec(name, path=None, target=None):
            if name == "yt_dlp":
                return PathFinder.find_spec(name, [str(ENGINE_ZIP)], target)
            return None

    sys.meta_path.insert(0, _EngineFinder)

import mutagen
import yt_dlp
from flask import Flask, Response, abort, jsonify, request, send_file, send_from_directory

VERSION = "0.1.0"
REPO = os.environ.get("SONORA_REPO", "levidang306/sonora")
FROZEN = getattr(sys, "frozen", False)
BASE_DIR = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
DATA_DIR = _DATA
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA_DIR / "library.db"
SETTINGS_PATH = DATA_DIR / "settings.json"
PORT = int(os.environ.get("SONORA_PORT", "5050"))
AUDIO_EXT = {".mp3", ".m4a", ".mp4", ".aac", ".flac", ".wav", ".aif", ".aiff", ".ogg", ".opus", ".alac"}

DEFAULT_SETTINGS = {
    "storage": str(Path(os.environ.get("SONORA_STORAGE", Path.home() / "Music" / "Sonora"))),
    "extra_folders": [],
    "default_quality": "original",
    "duplicates": "skip",  # skip | keep
    "accepted_terms": False,
}

app = Flask(__name__, static_folder=str(BASE_DIR / "static"))
LOCK = threading.RLock()
JOBS: dict[str, dict] = {}
PREVIEWS: dict[str, dict] = {}
POOL = ThreadPoolExecutor(max_workers=4)


# ============================================================ settings / ffmpeg
def load_settings() -> dict:
    s = dict(DEFAULT_SETTINGS)
    if SETTINGS_PATH.exists():
        try:
            s.update(json.loads(SETTINGS_PATH.read_text("utf-8")))
        except Exception:
            pass
    return s


def save_settings(s: dict):
    SETTINGS_PATH.write_text(json.dumps(s, ensure_ascii=False, indent=2), "utf-8")


_FF = None


def ffmpeg_path() -> str | None:
    """ffmpeg hệ thống (kèm ffprobe) nếu có, không thì static-ffmpeg tự tải bản cho macOS/Windows."""
    global _FF
    if _FF:
        return _FF
    exe = ".exe" if os.name == "nt" else ""
    bundled = BASE_DIR / "ffmpeg" / f"ffmpeg{exe}"  # bản build desktop đóng gói sẵn ffmpeg + ffprobe
    if bundled.is_file():
        os.environ["PATH"] = str(bundled.parent) + os.pathsep + os.environ.get("PATH", "")
        _FF = str(bundled)
        return _FF
    if not (shutil.which("ffmpeg") and shutil.which("ffprobe")):
        try:
            import static_ffmpeg

            static_ffmpeg.add_paths(weak=True)
        except Exception:
            pass
    _FF = shutil.which("ffmpeg")
    return _FF


def safe_name(s: str) -> str:
    return re.sub(r'[\\/:*?"<>|\x00-\x1f]+', "_", s or "").strip(" .") or "Untitled"


# ============================================================ quality model
LOSSLESS = {"flac", "alac", "wav", "aiff", "pcm"}
GOOD_MIN = {"mp3": 256, "aac": 160, "opus": 120, "vorbis": 192}


def norm_codec(c: str | None, ext: str | None = None) -> str:
    c = (c or "").lower()
    ext = (ext or "").lower().lstrip(".")
    if c.startswith("mp4a") or c == "aac":
        return "aac"
    for k in ("opus", "vorbis", "flac", "alac", "mp3"):
        if k in c:
            return k
    if c.startswith("pcm") or ext == "wav":
        return "wav"
    if ext in ("aif", "aiff"):
        return "aiff"
    if ext in ("flac", "mp3", "opus"):
        return ext
    if ext == "m4a":
        return "aac"
    if ext == "ogg":
        return "vorbis"
    return c or ext or "unknown"


def quality(codec: str, kbps: float | None = None, bits: int | None = None, original: bool = False) -> dict:
    """-> {label, tier}  tier: lossless (xanh) | good (vàng) | low (đỏ nhạt)"""
    codec = codec or "unknown"
    name = {"aac": "AAC", "mp3": "MP3", "opus": "Opus", "vorbis": "Vorbis", "flac": "FLAC", "alac": "ALAC",
            "wav": "WAV", "aiff": "AIFF"}.get(codec, codec.upper())
    if codec in LOSSLESS:
        if original and codec == "wav":
            return {"label": "WAV Original", "tier": "lossless"}
        return {"label": f"{name} {bits or 16}-bit", "tier": "lossless"}
    if original and not kbps:
        return {"label": f"{name} Original", "tier": "good"}
    if not kbps:
        return {"label": name if codec != "unknown" else "Unknown", "tier": "low"}
    tier = "good" if kbps >= GOOD_MIN.get(codec, 9999) else "low"
    return {"label": f"{name} {int(round(kbps))}k", "tier": tier}


TIER_RANK = {"low": 0, "good": 1, "lossless": 2}


# ============================================================ library DB
def db():
    con = sqlite3.connect(DB_PATH, timeout=30)
    con.row_factory = sqlite3.Row
    return con


def init_db():
    with db() as c:
        c.executescript(
            """
        CREATE TABLE IF NOT EXISTS tracks(
          id INTEGER PRIMARY KEY, path TEXT UNIQUE, title TEXT, artist TEXT, album TEXT, genre TEXT,
          duration REAL, codec TEXT, bitrate INTEGER, sample_rate INTEGER, bit_depth INTEGER, size INTEGER,
          q_label TEXT, q_tier TEXT, source_url TEXT, source_label TEXT, source_tier TEXT,
          favorite INTEGER DEFAULT 0, added_at REAL, has_cover INTEGER DEFAULT 0);
        CREATE TABLE IF NOT EXISTS playlists(id INTEGER PRIMARY KEY, name TEXT, created_at REAL);
        CREATE TABLE IF NOT EXISTS playlist_tracks(playlist_id INTEGER, track_id INTEGER, pos REAL,
          PRIMARY KEY(playlist_id, track_id));
        CREATE TABLE IF NOT EXISTS imports(id TEXT PRIMARY KEY, url TEXT, title TEXT, source TEXT, quality TEXT,
          status TEXT, total INTEGER, done INTEGER, folder TEXT, started REAL, finished REAL, log TEXT);
        """
        )


def extract_cover(f) -> tuple[bytes, str] | None:
    try:
        tags = getattr(f, "tags", None)
        if hasattr(tags, "getall"):  # ID3 (MP3, WAV, AIFF)
            for p in tags.getall("APIC"):
                return p.data, p.mime or "image/jpeg"
        if getattr(f, "pictures", None):  # FLAC
            p = f.pictures[0]
            return p.data, p.mime
        if tags is not None and "covr" in tags:  # MP4
            d = tags["covr"][0]
            return bytes(d), "image/png" if getattr(d, "imageformat", 13) == 14 else "image/jpeg"
        if tags is not None and "metadata_block_picture" in tags:  # Ogg
            from mutagen.flac import Picture

            p = Picture(base64.b64decode(tags["metadata_block_picture"][0]))
            return p.data, p.mime
    except Exception:
        return None
    return None


def read_audio(path: Path) -> dict | None:
    try:
        f = mutagen.File(path)
    except Exception:
        f = None
    if f is None or not getattr(f, "info", None):
        return None
    info = f.info
    kind = type(f).__name__
    codec = {"MP3": "mp3", "FLAC": "flac", "OggOpus": "opus", "OggVorbis": "vorbis", "WAVE": "wav", "AIFF": "aiff",
             "AAC": "aac"}.get(kind)
    if kind == "MP4":
        codec = "alac" if "alac" in (getattr(info, "codec", "") or "") else "aac"
    codec = codec or norm_codec(None, path.suffix)
    length = getattr(info, "length", 0) or 0
    br = getattr(info, "bitrate", 0) or 0
    if not br and length:
        br = int(path.stat().st_size * 8 / length)
    kbps = round(br / 1000) if br else None
    bits = getattr(info, "bits_per_sample", None)

    def tag(*keys):
        tags = f.tags
        if tags is None:
            return None
        for k in keys:
            try:
                v = tags.get(k)
            except Exception:
                v = None
            if v is None:
                continue
            if hasattr(v, "text"):
                v = v.text
            if isinstance(v, list):
                v = v[0] if v else None
            if v:
                return str(v)
        return None

    q = quality(codec, kbps, bits)
    return {
        "title": tag("TIT2", "\xa9nam", "title", "TITLE") or path.stem,
        "artist": tag("TPE1", "\xa9ART", "artist", "ARTIST", "TPE2", "aART") or "Unknown artist",
        "album": tag("TALB", "\xa9alb", "album", "ALBUM") or "",
        "genre": tag("TCON", "\xa9gen", "genre", "GENRE") or "",
        "duration": length, "codec": codec, "bitrate": kbps, "sample_rate": getattr(info, "sample_rate", None),
        "bit_depth": bits, "size": path.stat().st_size, "q_label": q["label"], "q_tier": q["tier"],
        "has_cover": int(extract_cover(f) is not None),
    }


def index_file(path: Path, **extra) -> int | None:
    path = Path(path).resolve()
    meta = read_audio(path)
    if not meta:
        return None
    if extra.get("source_tier") and TIER_RANK.get(extra["source_tier"], 0) < TIER_RANK[meta["q_tier"]]:
        meta["q_tier"] = extra["source_tier"]  # convert từ nguồn kém hơn -> chất lượng thực tế = nguồn
    _COVER_CACHE.pop(path, None)
    with LOCK, db() as c:
        row = c.execute("SELECT id FROM tracks WHERE path=?", (str(path),)).fetchone()
        cols = dict(meta, **{k: v for k, v in extra.items() if v is not None})
        if row:
            c.execute(f"UPDATE tracks SET {', '.join(k + '=?' for k in cols)} WHERE id=?", (*cols.values(), row["id"]))
            return row["id"]
        cols.update(path=str(path), added_at=time.time())
        cur = c.execute(f"INSERT INTO tracks({', '.join(cols)}) VALUES({', '.join('?' * len(cols))})", tuple(cols.values()))
        return cur.lastrowid


def library_roots() -> list[Path]:
    s = load_settings()
    return [Path(os.path.expanduser(p)) for p in [s["storage"], *s.get("extra_folders", [])]]


def scan_library() -> dict:
    found, added = 0, 0
    with db() as c:
        known = {r["path"] for r in c.execute("SELECT path FROM tracks")}
    for root in library_roots():
        if not root.exists():
            continue
        for p in root.rglob("*"):
            if p.suffix.lower() in AUDIO_EXT and not any(x.startswith(".") for x in p.relative_to(root).parts):
                found += 1
                if str(p.resolve()) not in known and index_file(p):
                    added += 1
    with LOCK, db() as c:  # dọn bài đã bị xoá khỏi ổ đĩa
        gone = [r["id"] for r in c.execute("SELECT id, path FROM tracks") if not Path(r["path"]).exists()]
        c.executemany("DELETE FROM tracks WHERE id=?", [(i,) for i in gone])
        c.executemany("DELETE FROM playlist_tracks WHERE track_id=?", [(i,) for i in gone])
    return {"found": found, "added": added, "removed": len(gone)}


# ============================================================ tagging (Spotify metadata)
def tag_file(path: Path, meta: dict, cover: bytes | None):
    try:
        f = mutagen.File(path)
        kind = type(f).__name__
        if kind == "MP3":
            from mutagen.id3 import APIC, ID3, TALB, TCON, TDRC, TIT2, TPE1, TRCK

            try:
                tags = ID3(path)
            except Exception:
                tags = ID3()
            tags.setall("TIT2", [TIT2(encoding=3, text=meta["title"])])
            tags.setall("TPE1", [TPE1(encoding=3, text=meta["artist"])])
            for key, cls, val in (("TALB", TALB, meta.get("album")), ("TDRC", TDRC, meta.get("year")),
                                  ("TCON", TCON, meta.get("genre")), ("TRCK", TRCK, meta.get("track"))):
                if val:
                    tags.setall(key, [cls(encoding=3, text=str(val))])
            if cover:
                tags.setall("APIC", [APIC(encoding=3, mime="image/jpeg", type=3, desc="Cover", data=cover)])
            tags.save(path)
            return
        if kind == "MP4":
            from mutagen.mp4 import MP4Cover

            f["\xa9nam"], f["\xa9ART"] = meta["title"], meta["artist"]
            for key, val in (("\xa9alb", meta.get("album")), ("\xa9day", meta.get("year")), ("\xa9gen", meta.get("genre"))):
                if val:
                    f[key] = str(val)
            if cover:
                f["covr"] = [MP4Cover(cover, MP4Cover.FORMAT_JPEG)]
        else:  # FLAC / Ogg Opus / Vorbis
            f["title"], f["artist"] = meta["title"], meta["artist"]
            for key, val in (("album", meta.get("album")), ("date", meta.get("year")), ("genre", meta.get("genre"))):
                if val:
                    f[key] = str(val)
            if cover:
                from mutagen.flac import Picture

                pic = Picture()
                pic.type, pic.mime, pic.data = 3, "image/jpeg", cover
                if kind == "FLAC":
                    f.clear_pictures()
                    f.add_picture(pic)
                else:
                    f["metadata_block_picture"] = [base64.b64encode(pic.write()).decode()]
        f.save()
    except Exception as e:  # noqa: BLE001
        print("tag error", path, e)


def fetch(url: str, timeout=20) -> bytes | None:
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Sonora/1.0"}), timeout=timeout) as r:
            return r.read()
    except Exception:
        return None


# ============================================================ Spotify (via spotDL)
_SPOTIFY_READY = False


def spotify_init():
    global _SPOTIFY_READY
    with LOCK:
        if _SPOTIFY_READY:
            return
        from spotdl.utils.config import DEFAULT_CONFIG
        from spotdl.utils.spotify import SpotifyClient

        try:
            SpotifyClient.init(client_id=DEFAULT_CONFIG["client_id"], client_secret=DEFAULT_CONFIG["client_secret"],
                               user_auth=False, no_cache=True)
        except Exception as e:
            if "already" not in str(e).lower():
                raise
        _SPOTIFY_READY = True


def is_spotify(url: str) -> bool:
    return "spotify.com" in url or url.startswith("spotify:")


def spotify_match(song_dict: dict) -> str | None:
    from spotdl.providers.audio import YouTubeMusic
    from spotdl.types.song import Song

    try:
        return YouTubeMusic().search(Song.from_dict(song_dict))
    except Exception:
        return None


# ============================================================ source probing (yt-dlp)
def ydl_base(**kw) -> dict:
    return {"quiet": True, "no_warnings": True, "ffmpeg_location": ffmpeg_path(), "noplaylist": True, **kw}


def best_audio(info: dict) -> dict:
    fmts = info.get("formats") or [info]
    orig = next((f for f in fmts if f.get("format_id") == "download"), None)  # SoundCloud: file gốc nghệ sĩ cho tải
    sel = (info.get("requested_formats") or [info])[0] if info.get("format_id") else None
    if sel and not orig and sel.get("acodec") not in (None, "none"):  # đúng format yt-dlp sẽ tải
        codec = norm_codec(sel.get("acodec"), sel.get("ext"))
        kbps = sel.get("abr") or sel.get("tbr")
        return {"codec": codec, "kbps": round(kbps) if kbps else None, "original": False, **quality(codec, kbps)}
    if orig:
        codec = norm_codec(orig.get("acodec"), orig.get("ext"))
        return {"codec": codec, "kbps": orig.get("abr"), "original": True, **quality(codec, orig.get("abr"), None, True)}
    audio = [f for f in fmts if f.get("acodec") not in (None, "none")]
    if not audio:
        return {"codec": "unknown", "kbps": None, "original": False, **quality("unknown")}
    f = max(audio, key=lambda f: (f.get("vcodec") in (None, "none"), f.get("abr") or f.get("tbr") or 0))
    codec = norm_codec(f.get("acodec"), f.get("ext"))
    kbps = f.get("abr") or f.get("tbr")
    return {"codec": codec, "kbps": round(kbps) if kbps else None, "original": False, **quality(codec, kbps)}


def thumb_of(info: dict) -> str | None:
    if info.get("thumbnail"):
        return info["thumbnail"]
    th = info.get("thumbnails") or []
    return th[-1].get("url") if th else None


def run_preview(pid: str):
    p = PREVIEWS[pid]
    url = p["url"]
    try:
        if is_spotify(url):
            p["source"] = "spotify"
            spotify_init()
            from spotdl.utils.search import get_simple_songs

            songs = get_simple_songs([url])
            if not songs:
                raise RuntimeError("Không tìm thấy bài nào ở link này")
            first = songs[0]
            multi = len(songs) > 1 or "/track/" not in url
            p["title"] = (first.list_name or first.album_name) if multi else first.name
            p["subtitle"] = "Spotify · " + (", ".join(first.artists) if not multi else f"{len(songs)} tracks")
            p["cover"] = first.cover_url
            p["tracks"] = [{
                "i": i, "title": s.name, "artist": ", ".join(s.artists), "album": s.album_name, "duration": s.duration,
                "cover": s.cover_url, "url": s.url, "kind": "spotify", "song": s.json, "match": None,
                "quality": None, "status": "matching",
            } for i, s in enumerate(songs)]
            p["status"] = "probing"

            def probe_sp(t):
                yt = spotify_match(t["song"])
                if not yt:
                    t.update(status="nomatch", quality={"label": "No match", "tier": "low"})
                    return
                t["match"] = yt
                probe_url(t, yt, spotify_duration=t["duration"])

            list(POOL.map(probe_sp, p["tracks"]))
        else:
            with yt_dlp.YoutubeDL(ydl_base(extract_flat="in_playlist", noplaylist=False)) as y:
                info = y.extract_info(url, download=False)
            key = info.get("extractor_key") or "Web"
            p["source"] = re.sub(r"(set|playlist|user|tab|album|track|music)s?$", "", key.lower()) or key.lower()
            pretty = {"soundcloud": "SoundCloud", "youtube": "YouTube", "bandcamp": "Bandcamp", "mixcloud": "Mixcloud"}.get(p["source"], key)
            entries = info.get("entries")
            multi = entries is not None
            entries = [e for e in (list(entries) if multi else [info]) if e]
            p["title"] = info.get("title") or url
            p["subtitle"] = f"{pretty} · " + (f"{len(entries)} tracks" if multi else (info.get("uploader") or ""))
            p["cover"] = thumb_of(info)
            p["tracks"] = [{
                "i": i, "title": e.get("title") or e.get("url"), "artist": e.get("uploader") or e.get("artist") or "",
                "album": p["title"] if multi else "", "duration": e.get("duration"), "cover": thumb_of(e),
                "url": e.get("webpage_url") or e.get("url"), "kind": "yt", "quality": None, "status": "probing",
            } for i, e in enumerate(entries)]
            p["status"] = "probing"
            list(POOL.map(lambda t: probe_url(t, t["url"]), p["tracks"]))
        p["status"] = "ready"
    except Exception as e:  # noqa: BLE001
        p["status"] = "error"
        p["error"] = re.sub(r"\x1b\[[0-9;]*m", "", str(e))[:400]


def probe_url(t: dict, url: str, spotify_duration=None):
    try:
        with yt_dlp.YoutubeDL(ydl_base(format="download/bestaudio/best")) as y:
            info = y.extract_info(url, download=False)
        t.update(quality=best_audio(info), status="ok")
        if t["kind"] == "yt":
            t["title"] = info.get("title") or t["title"]
            t["artist"] = info.get("artist") or info.get("uploader") or t["artist"]
            t["duration"] = info.get("duration") or t["duration"]
            t["cover"] = thumb_of(info) or t["cover"]
        else:
            t["match_title"] = info.get("title")
            t["match_duration"] = info.get("duration")
            if spotify_duration and info.get("duration") and abs(info["duration"] - spotify_duration) > 4:
                t["warn"] = "Độ dài khác bản Spotify — có thể là phiên bản khác"
    except Exception as e:  # noqa: BLE001
        t.update(status="error", quality={"label": "Unavailable", "tier": "low"}, error=str(e)[:200])


# ============================================================ import job
class Cancelled(Exception):
    pass


def jlog(job, msg):
    with LOCK:
        job["log"].append(msg)
        job["log"] = job["log"][-200:]


def persist_job(job):
    with LOCK, db() as c:
        c.execute(
            "INSERT OR REPLACE INTO imports VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
            (job["id"], job["url"], job["title"], job["source"], job["quality"], job["status"], job["total"],
             len(job["files"]), job["folder"], job["started"], job.get("finished"), json.dumps(job["log"][-60:])),
        )


def glob_escape(s: str) -> str:
    return re.sub(r"([\[\]*?])", r"[\1]", s)


def run_import(jid: str):
    job = JOBS[jid]
    s = load_settings()
    folder = Path(job["folder"])
    folder.mkdir(parents=True, exist_ok=True)
    tmp = folder / ".sonora-tmp" / jid  # tải + convert ở đây rồi mới chuyển vào thư viện -> không bao giờ ghi đè file có sẵn
    qsel = job["quality"]
    # original: chỉ đổi container (webm -> .opus, ...) bằng stream copy, không nén lại
    convert = [{"key": "FFmpegExtractAudio", "preferredcodec": "best"}] if qsel == "original" else []
    if qsel != "original":
        convert.append({"key": "FFmpegExtractAudio", "preferredcodec": {"aac": "m4a"}.get(qsel, qsel),
                        "preferredquality": {"mp3": "320", "aac": "256"}.get(qsel, "0")})
    final: dict = {}

    def hook(d):
        if job["cancel"]:
            raise Cancelled()
        if d["status"] == "downloading":
            done = d.get("downloaded_bytes") or 0
            tot = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            job["track_progress"] = round(done * 100 / tot) if tot else None

    persist_job(job)
    for n, t in enumerate(job["tracks"], 1):
        if job["cancel"]:
            break
        job.update(current=t["title"], index=n, track_progress=0)
        src_url = t.get("match") if t["kind"] == "spotify" else t["url"]
        if t["kind"] == "spotify" and not src_url:
            src_url = t["match"] = spotify_match(t["song"])
        if not src_url:
            jlog(job, f"✖ {t['title']}: không tìm thấy bản khớp")
            job["errors"] += 1
            continue
        name = f"{t['artist']} - {t['title']}" if t["kind"] == "spotify" else t["title"]
        if job["numbered"]:
            name = f"{t['i'] + 1:02d} - {name}"
        base = folder / safe_name(name)
        want = {"original": None, "aac": ".m4a"}.get(qsel, "." + qsel)
        existing = [p for p in folder.glob(glob_escape(base.name) + ".*")
                    if p.suffix.lower() in AUDIO_EXT and (want is None or p.suffix.lower() == want)]
        if existing and s.get("duplicates", "skip") == "skip":
            jlog(job, f"↷ Đã có, bỏ qua: {existing[0].name}")
            job["files"].append({"path": str(existing[0]), "track_id": index_file(existing[0]), "skipped": True})
            continue
        sq = t.get("quality") or {}
        is_wav = qsel == "wav" or (qsel == "original" and sq.get("codec") in ("wav", "aiff"))
        pps = list(convert)
        if t["kind"] != "spotify":
            pps.append({"key": "FFmpegMetadata", "add_metadata": True})
            if not is_wav:
                pps.append({"key": "EmbedThumbnail"})
        final.clear()
        opts = ydl_base(
            format="download/bestaudio/best" if qsel == "original" else "bestaudio/best",
            outtmpl=str(tmp / base.name) + ".%(ext)s", postprocessors=pps, writethumbnail=t["kind"] != "spotify" and not is_wav,
            progress_hooks=[hook], post_hooks=[lambda fp: final.__setitem__("path", fp)], retries=5,
            fragment_retries=5, concurrent_fragment_downloads=4, overwrites=True,
        )
        try:
            jlog(job, f"↓ {t['title']}")
            with yt_dlp.YoutubeDL(opts) as y:
                y.download([src_url])
            got = Path(final.get("path", ""))
            if not got.is_file():
                raise RuntimeError("không tìm thấy file sau khi tải")
            fp = folder / got.name
            if fp.exists() and s.get("duplicates", "skip") == "skip":
                fp = folder / f"{got.stem} ({time.strftime('%Y%m%d-%H%M%S')}){got.suffix}"
            os.replace(got, fp)
            if t["kind"] == "spotify":
                sd = t.get("song") or {}
                tag_file(fp, {"title": t["title"], "artist": t["artist"], "album": t.get("album"),
                              "year": sd.get("year"), "genre": ", ".join(g for g in (sd.get("genres") or []) if g)[:60],
                              "track": sd.get("track_number")}, fetch(t["cover"]) if t.get("cover") else None)
            tid = index_file(fp, source_url=t["url"], source_label=sq.get("label"), source_tier=sq.get("tier"))
            job["files"].append({"path": str(fp), "track_id": tid})
            with db() as c:
                r = c.execute("SELECT q_label FROM tracks WHERE id=?", (tid,)).fetchone()
            jlog(job, f"✔ {fp.name}  [{r['q_label'] if r else '?'}]")
        except Cancelled:
            jlog(job, "■ Đã huỷ — file dở dang đã được dọn")
            break
        except Exception as e:  # noqa: BLE001
            job["errors"] += 1
            msg = re.sub(r"\x1b\[[0-9;]*m", "", str(e))[:200]
            jlog(job, f"✖ {t['title']}: {msg}")
        persist_job(job)
    shutil.rmtree(tmp, ignore_errors=True)
    try:
        tmp.parent.rmdir()
    except OSError:
        pass
    job["status"] = "cancelled" if job["cancel"] else ("done" if not job["errors"] else ("partial" if job["files"] else "error"))
    job["finished"] = time.time()
    job["current"] = None
    persist_job(job)


# ============================================================ API: library
def track_row(r) -> dict:
    d = dict(r)
    d["folder"] = str(Path(d["path"]).parent)
    d["filename"] = Path(d["path"]).name
    return d


@app.get("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.get("/api/state")
def state():
    s = load_settings()
    with db() as c:
        stats = c.execute("SELECT COUNT(*) n, COALESCE(SUM(size),0) size FROM tracks").fetchone()
        pls = [dict(r) for r in c.execute(
            "SELECT p.id, p.name, COUNT(pt.track_id) n FROM playlists p LEFT JOIN playlist_tracks pt ON pt.playlist_id=p.id "
            "GROUP BY p.id ORDER BY p.created_at")]
        paths = [r["path"] for r in c.execute("SELECT path FROM tracks")]
    folders: dict[str, int] = {}
    for p in paths:
        k = str(Path(p).parent)
        folders[k] = folders.get(k, 0) + 1
    storage = Path(os.path.expanduser(s["storage"]))
    storage.mkdir(parents=True, exist_ok=True)
    du = shutil.disk_usage(storage)
    return jsonify({
        "settings": s, "tracks": stats["n"], "size": stats["size"], "free": du.free, "playlists": pls,
        "folders": [{"path": k, "name": Path(k).name, "n": v} for k, v in sorted(folders.items())],
        "ffmpeg": bool(ffmpeg_path()), "version": VERSION, "engine": yt_dlp.version.__version__,
        "engine_custom": ENGINE_ZIP.is_file() and ".zip" in (yt_dlp.__file__ or ""), "repo": REPO, "running": sum(1 for j in JOBS.values() if j["status"] == "running"),
    })


@app.get("/api/tracks")
def tracks():
    view = request.args.get("view", "all")
    q = request.args.get("q", "").strip()
    tier = request.args.get("tier", "")
    sql, args, where, order = "SELECT t.* FROM tracks t", [], [], "t.added_at DESC, t.path"
    if view == "favorites":
        where.append("t.favorite=1")
    elif view == "recent":
        where.append("t.added_at > ?")
        args.append(time.time() - 14 * 86400)
    elif view == "playlist":
        sql += " JOIN playlist_tracks pt ON pt.track_id=t.id"
        where.append("pt.playlist_id=?")
        args.append(int(request.args["pid"]))
        order = "pt.pos"
    elif view == "folder":
        where.append("t.path LIKE ? ESCAPE '\\'")
        folder = request.args["folder"].rstrip("/\\") + os.sep
        args.append(folder.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%")
        order = "t.path"
    if q:
        where.append("(t.title LIKE ? OR t.artist LIKE ? OR t.album LIKE ? OR t.genre LIKE ?)")
        args += [f"%{q}%"] * 4
    if tier:
        where.append("t.q_tier=?")
        args.append(tier)
    if where:
        sql += " WHERE " + " AND ".join(where)
    with db() as c:
        return jsonify([track_row(r) for r in c.execute(f"{sql} ORDER BY {order}", args)])


def get_track(tid) -> dict:
    with db() as c:
        r = c.execute("SELECT * FROM tracks WHERE id=?", (tid,)).fetchone()
    if not r:
        abort(404)
    return track_row(r)


@app.get("/api/tracks/<int:tid>")
def track_detail(tid):
    t = get_track(tid)
    with db() as c:
        t["playlists"] = [r["playlist_id"] for r in c.execute("SELECT playlist_id FROM playlist_tracks WHERE track_id=?", (tid,))]
    return jsonify(t)


MIME = {".m4a": "audio/mp4", ".mp4": "audio/mp4", ".opus": "audio/ogg", ".ogg": "audio/ogg", ".flac": "audio/flac",
        ".wav": "audio/wav", ".mp3": "audio/mpeg", ".aif": "audio/aiff", ".aiff": "audio/aiff", ".aac": "audio/aac"}


@app.get("/api/tracks/<int:tid>/audio")
def track_audio(tid):
    t = get_track(tid)
    return send_file(t["path"], mimetype=MIME.get(Path(t["path"]).suffix.lower()), conditional=True)


_COVER_CACHE: dict = {}


@app.get("/api/tracks/<int:tid>/cover")
def track_cover(tid):
    t = get_track(tid)
    key = Path(t["path"])
    if key not in _COVER_CACHE:
        cov = None
        try:
            cov = extract_cover(mutagen.File(key))
        except Exception:
            pass
        if not cov:
            for n in ("cover.jpg", "folder.jpg", "cover.png"):
                p = key.parent / n
                if p.exists():
                    cov = (p.read_bytes(), "image/png" if n.endswith("png") else "image/jpeg")
                    break
        _COVER_CACHE[key] = cov
    cov = _COVER_CACHE[key]
    if not cov:
        abort(404)
    return Response(cov[0], mimetype=cov[1], headers={"Cache-Control": "max-age=3600"})


@app.post("/api/tracks/<int:tid>/favorite")
def favorite(tid):
    with LOCK, db() as c:
        c.execute("UPDATE tracks SET favorite=1-favorite WHERE id=?", (tid,))
    return jsonify(get_track(tid))


def reveal(path: str):
    is_file = Path(path).is_file()
    if sys.platform == "darwin":
        subprocess.Popen(["open", "-R", path] if is_file else ["open", path])
    elif os.name == "nt":
        subprocess.Popen(["explorer", "/select,", path] if is_file else ["explorer", path])
    else:
        subprocess.Popen(["xdg-open", str(Path(path).parent) if is_file else path])


@app.post("/api/tracks/<int:tid>/reveal")
def reveal_track(tid):
    reveal(get_track(tid)["path"])
    return jsonify(ok=True)


@app.post("/api/open")
def open_path():
    p = os.path.expanduser((request.get_json(force=True) or {}).get("path") or load_settings()["storage"])
    Path(p).mkdir(parents=True, exist_ok=True)
    reveal(p)
    return jsonify(ok=True)


# ---- playlists
@app.post("/api/playlists")
def create_playlist():
    name = ((request.get_json(force=True) or {}).get("name") or "New playlist").strip()[:80]
    with LOCK, db() as c:
        pid = c.execute("INSERT INTO playlists(name, created_at) VALUES(?,?)", (name, time.time())).lastrowid
    return jsonify({"id": pid, "name": name})


@app.patch("/api/playlists/<int:pid>")
def rename_playlist(pid):
    with LOCK, db() as c:
        c.execute("UPDATE playlists SET name=? WHERE id=?", (request.get_json(force=True)["name"][:80], pid))
    return jsonify(ok=True)


@app.delete("/api/playlists/<int:pid>")
def delete_playlist(pid):
    with LOCK, db() as c:
        c.execute("DELETE FROM playlists WHERE id=?", (pid,))
        c.execute("DELETE FROM playlist_tracks WHERE playlist_id=?", (pid,))
    return jsonify(ok=True)


@app.post("/api/playlists/<int:pid>/tracks")
def add_to_playlist(pid):
    ids = request.get_json(force=True).get("track_ids", [])
    with LOCK, db() as c:
        pos = c.execute("SELECT MAX(pos) m FROM playlist_tracks WHERE playlist_id=?", (pid,)).fetchone()["m"] or 0
        for i, tid in enumerate(ids, 1):
            c.execute("INSERT OR IGNORE INTO playlist_tracks VALUES(?,?,?)", (pid, tid, pos + i))
    return jsonify(ok=True)


@app.delete("/api/playlists/<int:pid>/tracks/<int:tid>")
def remove_from_playlist(pid, tid):
    with LOCK, db() as c:
        c.execute("DELETE FROM playlist_tracks WHERE playlist_id=? AND track_id=?", (pid, tid))
    return jsonify(ok=True)


# ---- settings / scan
@app.route("/api/settings", methods=["GET", "POST"])
def settings():
    s = load_settings()
    if request.method == "POST":
        data = request.get_json(force=True)
        for k in DEFAULT_SETTINGS:
            if k in data:
                s[k] = data[k]
        s["accepted_terms"] = bool(s.get("accepted_terms"))
        s["storage"] = os.path.expanduser(str(s["storage"]).strip())
        s["extra_folders"] = [os.path.expanduser(x.strip()) for x in s.get("extra_folders", []) if x.strip()]
        Path(s["storage"]).mkdir(parents=True, exist_ok=True)
        save_settings(s)
    return jsonify(s)


@app.post("/api/scan")
def scan():
    return jsonify(scan_library())


# ============================================================ API: import
@app.post("/api/preview")
def preview():
    url = ((request.get_json(force=True) or {}).get("url") or "").strip()
    if not re.match(r"^(https?://|spotify:)", url):
        return jsonify(error="Dán một link http(s):// hoặc spotify:"), 400
    pid = uuid.uuid4().hex[:10]
    PREVIEWS[pid] = {"id": pid, "url": url, "status": "loading", "title": None, "subtitle": "", "tracks": [], "source": None}
    threading.Thread(target=run_preview, args=(pid,), daemon=True).start()
    return jsonify({"id": pid})


@app.get("/api/preview/<pid>")
def preview_get(pid):
    p = PREVIEWS.get(pid) or abort(404)
    return jsonify(dict(p, tracks=[{k: v for k, v in t.items() if k != "song"} for t in p["tracks"]]))


@app.get("/api/stream")
def stream():
    """Nghe thử: lấy đúng luồng audio sẽ tải về, convert tạm sang MP3 để trình duyệt nào cũng phát được."""
    p = PREVIEWS.get(request.args.get("pid")) or abort(404)
    t = p["tracks"][int(request.args.get("i", 0))]
    url = t["url"]
    if t["kind"] == "spotify":
        url = t.get("match") or spotify_match(t["song"])
        t["match"] = url
    if not url:
        abort(404)
    with yt_dlp.YoutubeDL(ydl_base(format="bestaudio[protocol^=http]/bestaudio/best")) as y:
        info = y.extract_info(url, download=False)
    src = info.get("url") or (info.get("requested_formats") or [{}])[0].get("url")
    headers = "".join(f"{k}: {v}\r\n" for k, v in (info.get("http_headers") or {}).items())
    cmd = [ffmpeg_path(), "-hide_banner", "-loglevel", "error"]
    if headers:
        cmd += ["-headers", headers]
    cmd += ["-i", src, "-vn", "-c:a", "libmp3lame", "-b:a", "192k", "-f", "mp3", "pipe:1"]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))

    def gen():
        try:
            while chunk := proc.stdout.read(32768):
                yield chunk
        finally:
            proc.kill()

    return Response(gen(), mimetype="audio/mpeg", headers={"Cache-Control": "no-store"})


@app.post("/api/import")
def start_import():
    data = request.get_json(force=True)
    p = PREVIEWS.get(data.get("preview_id")) or abort(404)
    idx = set(data.get("indexes") or [])
    sel = [t for t in p["tracks"] if t["i"] in idx]
    if not sel:
        return jsonify(error="Chưa chọn bài nào"), 400
    s = load_settings()
    multi = len(p["tracks"]) > 1
    sub = p["title"] if multi else ("Spotify" if p["source"] == "spotify" else "Singles")
    folder = Path(os.path.expanduser(s["storage"])) / safe_name(sub)
    jid = uuid.uuid4().hex[:10]
    JOBS[jid] = {
        "id": jid, "url": p["url"], "title": p["title"], "source": p["source"], "quality": data.get("quality", "original"),
        "tracks": sel, "total": len(sel), "folder": str(folder), "status": "running", "log": [], "files": [],
        "errors": 0, "cancel": False, "current": None, "index": 0, "track_progress": 0, "started": time.time(),
        "numbered": multi and p["source"] != "spotify",
    }
    threading.Thread(target=run_import, args=(jid,), daemon=True).start()
    return jsonify({"id": jid, "folder": str(folder)})


@app.post("/api/import/files")
def import_files():
    s = load_settings()
    dest_root = Path(os.path.expanduser(s["storage"])) / "Local imports"
    added, skipped = [], 0
    for f in request.files.getlist("files"):
        parts = [safe_name(x) for x in f.filename.replace("\\", "/").split("/") if x not in ("", ".", "..")]
        if not parts or Path(parts[-1]).suffix.lower() not in AUDIO_EXT:
            skipped += 1
            continue
        dest = dest_root.joinpath(*parts)
        dest.parent.mkdir(parents=True, exist_ok=True)
        if dest.exists() and s.get("duplicates", "skip") == "skip":
            added.append(index_file(dest))
            continue
        f.save(dest)  # giữ nguyên file, không convert
        added.append(index_file(dest))
    return jsonify({"added": [a for a in added if a], "skipped": skipped, "folder": str(dest_root)})


@app.get("/api/jobs")
def jobs():
    live = [{k: v for k, v in j.items() if k not in ("tracks", "cancel")} for j in JOBS.values()]
    with db() as c:
        hist = [dict(r) for r in c.execute("SELECT * FROM imports ORDER BY started DESC LIMIT 50") if r["id"] not in JOBS]
    for h in hist:
        h["log"] = json.loads(h["log"] or "[]")
        h["files"] = [None] * (h.pop("done") or 0)
        if h["status"] == "running":
            h["status"] = "cancelled"  # app bị tắt giữa chừng
    return jsonify(sorted(live, key=lambda j: -j["started"]) + hist)


@app.post("/api/jobs/<jid>/cancel")
def cancel(jid):
    if jid in JOBS:
        JOBS[jid]["cancel"] = True
    return jsonify(ok=True)


@app.delete("/api/jobs")
def clear_history():
    with LOCK, db() as c:
        c.execute("DELETE FROM imports WHERE status != 'running'")
    for k in [k for k, j in JOBS.items() if j["status"] != "running"]:
        JOBS.pop(k)
    return jsonify(ok=True)


# ============================================================ updates (app + download engine)
_UPDATE: dict = {}


def _vtuple(v: str):
    return tuple(int(x) for x in re.findall(r"\d+", v or "0")[:4])


@app.get("/api/update-check")
def update_check():
    if not _UPDATE or time.time() - _UPDATE.get("t", 0) > 3600:
        app_rel = fetch(f"https://api.github.com/repos/{REPO}/releases/latest", 10)
        eng_rel = fetch("https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest", 10)
        try:
            a = json.loads(app_rel) if app_rel else {}
            e = json.loads(eng_rel) if eng_rel else {}
        except Exception:
            a, e = {}, {}
        _UPDATE.update(t=time.time(), app_latest=a.get("tag_name"), app_url=a.get("html_url"), engine_latest=e.get("tag_name"))
    return jsonify({
        "version": VERSION, "app_latest": _UPDATE.get("app_latest"), "app_url": _UPDATE.get("app_url"),
        "app_update": bool(_UPDATE.get("app_latest")) and _vtuple(_UPDATE["app_latest"]) > _vtuple(VERSION),
        "engine": yt_dlp.version.__version__, "engine_latest": _UPDATE.get("engine_latest"),
        "engine_update": bool(_UPDATE.get("engine_latest")) and _vtuple(_UPDATE["engine_latest"]) > _vtuple(yt_dlp.version.__version__),
    })


@app.post("/api/engine/update")
def engine_update():
    """Tải bản yt-dlp mới nhất (zipapp chính thức, Unlicense) — có hiệu lực sau khi mở lại app."""
    import zipfile

    data = fetch("https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp", 120)
    if not data:
        return jsonify(error="Không tải được bản cập nhật"), 502
    ENGINE_ZIP.parent.mkdir(parents=True, exist_ok=True)
    tmp = ENGINE_ZIP.with_suffix(".tmp")
    tmp.write_bytes(data)
    try:
        with zipfile.ZipFile(tmp) as z:
            ok = "yt_dlp/__init__.py" in z.namelist()
    except zipfile.BadZipFile:
        ok = False
    if not ok:
        tmp.unlink(missing_ok=True)
        return jsonify(error="File cập nhật không hợp lệ"), 502
    os.replace(tmp, ENGINE_ZIP)
    return jsonify(ok=True, restart=True)


@app.post("/api/engine/reset")
def engine_reset():
    ENGINE_ZIP.unlink(missing_ok=True)
    return jsonify(ok=True, restart=True)


# ============================================================ main
init_db()


def start_server(port: int = PORT):
    ffmpeg_path()
    threading.Thread(target=scan_library, daemon=True).start()
    app.run(host="127.0.0.1", port=port, debug=False, threaded=True, use_reloader=False)


if __name__ == "__main__":
    url = f"http://127.0.0.1:{PORT}"
    print(f"Sonora {VERSION} đang chạy tại {url}\nThư viện: {load_settings()['storage']}")
    if "--no-browser" not in sys.argv:
        threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    start_server(PORT)
