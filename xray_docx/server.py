"""Static development server. DOCX processing happens in the browser worker."""

import argparse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PUBLIC = Path(__file__).resolve().parent.parent / "public"


class LocalHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(PUBLIC), **kwargs)

    def log_message(self, *_):
        pass


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args()
    print(f"Xray DOCX static server: http://{args.host}:{args.port}", flush=True)
    ThreadingHTTPServer((args.host, args.port), LocalHandler).serve_forever()


if __name__ == "__main__":
    main()
