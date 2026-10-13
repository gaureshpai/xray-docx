"""Serve built static assets with the same security headers as Vercel."""

import json
from http.server import ThreadingHTTPServer
from pathlib import Path

from docx_ray.server import LocalHandler

CONFIG = json.loads(Path("vercel.json").read_text())


class BrowserHandler(LocalHandler):
    def end_headers(self):
        for rule in CONFIG["headers"]:
            for header in rule["headers"]:
                self.send_header(header["key"], header["value"])
        super().end_headers()


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", 8123), BrowserHandler).serve_forever()
