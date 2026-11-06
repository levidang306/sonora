"""Build Sonora desktop app cho máy hiện tại (macOS .app hoặc Windows .exe).

    python packaging/build.py

Kết quả: dist/Sonora-<os>-<arch>.zip
"""
import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "build"
DIST = ROOT / "dist"
SEP = ";" if os.name == "nt" else ":"


def fetch_ffmpeg() -> Path:
    """Lấy ffmpeg + ffprobe static (static-ffmpeg) cho đúng nền tảng để đóng gói kèm app."""
    import static_ffmpeg

    static_ffmpeg.add_paths(weak=False)
    exe = ".exe" if os.name == "nt" else ""
    out = BUILD / "ffmpeg"
    shutil.rmtree(out, ignore_errors=True)
    out.mkdir(parents=True)
    for name in ("ffmpeg", "ffprobe"):
        src = shutil.which(name + exe) or shutil.which(name)
        if not src:
            sys.exit(f"Không tìm thấy {name}")
        shutil.copy2(src, out / f"{name}{exe}")
    return out


def make_icon() -> Path:
    from PIL import Image, ImageDraw

    size = 1024
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((64, 64, size - 64, size - 64), radius=200, fill=(13, 15, 18, 255))
    r = 230
    cx, cy = size // 2 - 40, size // 2
    d.ellipse((cx - r + 90, cy - r, cx + r + 90, cy + r), fill=(169, 207, 56, 255))
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(216, 255, 70, 255))
    path = BUILD / "icon.png"
    BUILD.mkdir(exist_ok=True)
    img.save(path)
    return path


def main():
    ff = fetch_ffmpeg()
    icon = make_icon()
    is_mac = sys.platform == "darwin"
    args = [
        sys.executable, "-m", "PyInstaller", str(ROOT / "desktop.py"),
        "--name", "Sonora", "--noconfirm", "--clean", "--windowed", "--onedir",
        "--distpath", str(DIST), "--workpath", str(BUILD / "pyi"), "--specpath", str(BUILD),
        "--icon", str(icon),
        "--add-data", f"{ROOT / 'static'}{SEP}static",
        "--add-data", f"{ROOT / 'THIRD_PARTY_NOTICES.md'}{SEP}.",
        "--add-data", f"{ROOT / 'LICENSE'}{SEP}.",
        "--add-binary", f"{ff}{os.sep}*{SEP}ffmpeg",
        "--hidden-import", "app",
        "--collect-all", "spotdl", "--collect-all", "ytmusicapi", "--collect-all", "pykakasi",
        "--collect-submodules", "yt_dlp", "--collect-submodules", "mutagen",
        "--exclude-module", "tkinter", "--exclude-module", "static_ffmpeg",
        "--paths", str(ROOT),
    ]
    if is_mac:
        args += ["--osx-bundle-identifier", "io.github.sonora"]
    subprocess.check_call(args, cwd=ROOT)

    arch = {"x86_64": "x64", "amd64": "x64", "arm64": "arm64", "aarch64": "arm64"}.get(platform.machine().lower(), platform.machine())
    if is_mac:
        plist = DIST / "Sonora.app" / "Contents" / "Info.plist"
        subprocess.run(["plutil", "-replace", "CFBundleShortVersionString", "-string", version(), str(plist)], check=True)
        subprocess.run(["plutil", "-replace", "NSHighResolutionCapable", "-bool", "true", str(plist)], check=True)
        subprocess.run(["codesign", "--force", "--deep", "--sign", "-", str(DIST / "Sonora.app")], check=True)  # ad-hoc
        out = DIST / f"Sonora-macOS-{arch}.zip"
        out.unlink(missing_ok=True)
        subprocess.check_call(["ditto", "-c", "-k", "--keepParent", str(DIST / "Sonora.app"), str(out)])
    else:
        out = DIST / f"Sonora-Windows-{arch}"
        shutil.make_archive(str(out), "zip", DIST, "Sonora")
        out = out.with_suffix(".zip")
    print("Built", out, f"{out.stat().st_size / 1e6:.1f} MB")


def version() -> str:
    import re

    return re.search(r'VERSION = "([^"]+)"', (ROOT / "app.py").read_text("utf-8")).group(1)


if __name__ == "__main__":
    main()
