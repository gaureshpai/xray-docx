"""Local development server. Static assets + the same API used on Vercel."""

import argparse
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

from .routes import ApiHandler

PUBLIC = Path(__file__).resolve().parent.parent / "public"
ASSETS = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/app.js": ("app.js", "text/javascript; charset=utf-8"),
    "/style.css": ("style.css", "text/css; charset=utf-8"),
    "/sample.docx": ("sample.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
}


class LocalHandler(ApiHandler):
    def do_GET(self):
        asset = ASSETS.get(urlsplit(self.path).path)
        if asset:
            self.respond(200, (PUBLIC / asset[0]).read_bytes(), asset[1])
        else:
            super().do_GET()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args()
    print(f"DOCX Ray running at http://{args.host}:{args.port}", flush=True)
    ThreadingHTTPServer((args.host, args.port), LocalHandler).serve_forever()


if __name__ == "__main__":
    main()
