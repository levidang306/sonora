"""Sonora desktop — mở app trong cửa sổ native (pywebview) thay vì trình duyệt.

Build: xem packaging/build.py. Chạy thử: python desktop.py
"""
import os
import socket
import sys
import threading
import time
import urllib.request


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def wait_ready(url: str, timeout: float = 120) -> bool:
    end = time.time() + timeout
    last = None
    while time.time() < end:
        try:
            urllib.request.urlopen(url + "/api/state", timeout=2)
            return True
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(0.25)
    print(f"Sonora: server not ready after {timeout}s: {last!r}", file=sys.stderr)
    return False


def main():
    # Trên macOS app mở từ Finder không có PATH của shell; đặt CWD về home cho chắc chắn
    os.chdir(os.path.expanduser("~"))
    port = int(os.environ.get("SONORA_PORT") or free_port())
    url = f"http://127.0.0.1:{port}"

    import app as server  # noqa: E402  (import sau khi đã xử lý môi trường)

    threading.Thread(target=server.start_server, args=(port,), daemon=True).start()
    if not wait_ready(url):
        print("Sonora: server không khởi động được", file=sys.stderr)
        sys.exit(1)

    if os.environ.get("SONORA_HEADLESS") == "1":  # smoke test / CI: chỉ chạy server
        print(f"SONORA_READY {url}", flush=True)
        while True:
            time.sleep(3600)

    try:
        import webview
    except Exception:  # không có pywebview -> mở trình duyệt
        import webbrowser

        webbrowser.open(url)
        while True:
            time.sleep(3600)

    webview.settings["OPEN_EXTERNAL_LINKS_IN_BROWSER"] = True
    webview.settings["ALLOW_DOWNLOADS"] = False
    webview.create_window(
        "Sonora", url, width=1380, height=880, min_size=(900, 600), background_color="#0d0f12", text_select=True,
    )
    webview.start(private_mode=False, storage_path=str(server.DATA_DIR / "webview"))


if __name__ == "__main__":
    main()
