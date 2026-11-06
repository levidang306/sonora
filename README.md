# Sonora

**Local-first music player.** Nhập nhạc từ file, folder hoặc link (SoundCloud, Spotify, YouTube, Bandcamp…), **giữ nguyên chất lượng nguồn** và quản lý toàn bộ thư viện ngay trên máy bạn.

> Sonora không phải dịch vụ online: không tài khoản, không server, nhạc nằm trong thư mục bạn chọn.

## Tính năng

- **Import preview** — dán link, xem danh sách bài, **nghe thử đúng luồng sẽ tải về**, chọn bài trước khi tải
- **Chất lượng minh bạch** — mỗi bài có badge chất lượng *thực tế* của nguồn
  - 🟢 lossless / file gốc (`FLAC 24-bit`, `WAV Original`)
  - 🟡 nén nhưng tốt (`AAC 160k`, `Opus 129k`, `MP3 320k`)
  - 🔴 thấp / không rõ
- **Không tự convert** — mặc định *Original* giữ nguyên luồng tốt nhất nguồn cung cấp. Nếu bạn chọn FLAC/WAV từ nguồn nén, app cảnh báo rằng nó **không làm hay hơn**, và badge vẫn ghi `from AAC 160k`
- Ưu tiên file gốc khi nghệ sĩ bật nút tải trên SoundCloud
- Spotify: lấy metadata + ảnh bìa từ Spotify, tìm bản khớp trên YouTube Music, cảnh báo khi độ dài lệch (có thể là bản khác)
- Thư viện local (SQLite): All music, Favorites, Recently added, Playlists, Local folders, tìm kiếm, lọc theo chất lượng
- Player: queue, shuffle, repeat, phím tắt, phím media của hệ điều hành
- Kéo thả file/folder — copy nguyên bản, không convert
- Huỷ được khi đang tải; không bao giờ ghi đè file có sẵn
- Cập nhật *download engine* (yt-dlp) ngay trong app, không cần cài lại

## Tải về

Vào [Releases](../../releases/latest):

| Hệ điều hành | File |
|---|---|
| macOS Apple Silicon (M1–M4) | `Sonora-macOS-arm64.zip` |
| macOS Intel | `Sonora-macOS-x64.zip` |
| Windows 10/11 | `Sonora-Windows-x64.zip` |

App **chưa được ký số** nên lần đầu mở sẽ bị cảnh báo:

- **macOS:** giải nén, kéo `Sonora.app` vào Applications, mở → bị chặn → **System Settings → Privacy & Security → Open Anyway**.
  Hoặc chạy: `xattr -dr com.apple.quarantine /Applications/Sonora.app`
- **Windows:** giải nén, chạy `Sonora.exe` → SmartScreen → **More info → Run anyway**. Cần WebView2 (có sẵn trên Windows 10/11).

Thư viện mặc định: `~/Music/Sonora` (đổi trong Settings). Dữ liệu app: `~/.sonora/`.

## Chạy từ source

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python app.py            # mở trong trình duyệt: http://127.0.0.1:5050
```

Cửa sổ native: `pip install pywebview` rồi `python desktop.py`.
Hoặc double-click `start-mac.command` / `start-windows.bat`.

## Build

```bash
pip install -r requirements.txt -r packaging/requirements-build.txt
python packaging/build.py          # -> dist/Sonora-<os>-<arch>.zip
python packaging/smoke_test.py
```

Push tag `vX.Y.Z` (khớp `VERSION` trong `app.py`) → GitHub Actions build macOS arm64/x64 + Windows x64 và tạo Release.

## ⚠️ Sử dụng hợp pháp

Sonora là trình phát nhạc. Tính năng import từ link **chỉ dành cho nội dung bạn sở hữu hoặc được phép tải**: nhạc của chính bạn, nhạc Creative Commons, hoặc bài nghệ sĩ bật tải.
Tải nhạc có bản quyền khi chưa được phép có thể vi phạm luật bản quyền nơi bạn sống và điều khoản sử dụng của SoundCloud, YouTube, Spotify. Bạn tự chịu trách nhiệm về cách mình sử dụng phần mềm.

Sonora **không phá DRM**: với link Spotify, app chỉ đọc metadata công khai từ Spotify và tìm bản tương ứng trên YouTube Music.
Sonora không liên kết với, không được tài trợ hay xác nhận bởi SoundCloud, Spotify, YouTube hay Google.

## License

[GPL-3.0-or-later](LICENSE). Thành phần bên thứ ba: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
Built on [yt-dlp](https://github.com/yt-dlp/yt-dlp), [spotDL](https://github.com/spotDL/spotify-downloader), [mutagen](https://github.com/quodlibet/mutagen), [FFmpeg](https://ffmpeg.org), [Flask](https://flask.palletsprojects.com), [pywebview](https://pywebview.flowrl.com).
