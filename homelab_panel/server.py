"""HTTP API and static file server. POST is refused. Nothing is changed."""

from __future__ import annotations

import argparse
import json
import mimetypes
import threading
import time
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from homelab_panel.collect import collect_snapshot
from homelab_panel.config import ConfigError, load_config
from homelab_panel.state import build_state

CACHE_SECONDS = 5


class Panel:
    def __init__(self, config, provider, assets):
        self.config = config
        self.provider = provider
        self.assets = assets
        self._lock = threading.Lock()
        self._at = 0.0
        self._state = None

    def state(self):
        now = time.monotonic()
        with self._lock:
            if self._state is None or now - self._at > float(self.config.get("cache_seconds") or CACHE_SECONDS):
                self._state = build_state(self.config, self.provider())
                self._at = now
            return self._state

    def handle(self, method, path):
        if method == "POST":
            return 405, {"Allow": "GET"}, b""
        if method != "GET":
            return 405, {"Allow": "GET"}, b""
        clean = path.split("?", 1)[0]
        if clean == "/api/state":
            body = json.dumps(self.state()).encode()
            return 200, {"Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store"}, body
        asset = self.assets.get(clean)
        if asset is None and clean != "/":
            asset = self.assets.get("/")
        if asset is None:
            return 404, {"Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store"}, b"not found"
        headers = {"Content-Type": asset[0], "Cache-Control": "no-store"}
        return 200, headers, asset[1]


class DirectoryAssets:
    def __init__(self, root):
        self.root = Path(root)

    def get(self, url_path):
        relative = "index.html" if url_path == "/" else url_path.lstrip("/")
        if relative.startswith("/") or ".." in Path(relative).parts:
            return None
        file = (self.root / relative).resolve()
        try:
            file.relative_to(self.root.resolve())
        except ValueError:
            return None
        if not file.is_file():
            return None
        mime = mimetypes.guess_type(file.name)[0] or "application/octet-stream"
        if file.suffix == ".js":
            mime = "text/javascript; charset=utf-8"
        elif file.suffix == ".css":
            mime = "text/css; charset=utf-8"
        elif file.suffix == ".html":
            mime = "text/html; charset=utf-8"
        return mime, file.read_bytes()


class ZipAssets:
    def __init__(self, archive, prefix="ui/dist/"):
        self.archive = archive
        self.prefix = prefix

    def get(self, url_path):
        relative = "index.html" if url_path == "/" else url_path.lstrip("/")
        if relative.startswith("/") or ".." in Path(relative).parts:
            return None
        name = self.prefix + relative
        try:
            with zipfile.ZipFile(self.archive) as bundle:
                data = bundle.read(name)
        except (KeyError, OSError, zipfile.BadZipFile):
            return None
        suffix = Path(relative).suffix
        if suffix == ".js":
            mime = "text/javascript; charset=utf-8"
        elif suffix == ".css":
            mime = "text/css; charset=utf-8"
        elif suffix == ".html":
            mime = "text/html; charset=utf-8"
        else:
            mime = mimetypes.guess_type(relative)[0] or "application/octet-stream"
        return mime, data


def assets_from_runtime():
    import sys

    argv0 = Path(sys.argv[0]).resolve()
    if zipfile.is_zipfile(argv0):
        return ZipAssets(argv0)
    root = Path(__file__).resolve().parents[1] / "ui" / "dist"
    return DirectoryAssets(root)


def make_handler(panel):
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            self._send(*panel.handle("GET", self.path))

        def do_POST(self):
            self._send(*panel.handle("POST", self.path))

        def _send(self, status, headers, body):
            self.send_response(status)
            for key, value in headers.items():
                self.send_header(key, value)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, fmt, *args):
            return

    return Handler


def serve(config, provider=None, assets=None):
    panel = Panel(config, provider or (lambda: collect_snapshot(config)), assets or assets_from_runtime())
    server = ThreadingHTTPServer((config["bind_host"], config["bind_port"]), make_handler(panel))
    server.serve_forever()


def main(argv=None):
    parser = argparse.ArgumentParser(description="Read-only homelab maintenance page")
    parser.add_argument("--config", required=True)
    args = parser.parse_args(argv)
    try:
        config = load_config(args.config)
    except ConfigError as exc:
        raise SystemExit(str(exc)) from exc
    serve(config)


if __name__ == "__main__":
    main()
