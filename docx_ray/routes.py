"""HTTP routes shared by local server and Vercel's Python function."""

import json
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, unquote, urlsplit

from .models import WEB_LIMITS, DocxError
from .service import inspect_docx, xml_bundle, xml_part


class ApiHandler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        # Never log document names or contents.
        pass

    def respond(self, status, body, content_type="application/json; charset=utf-8", download=False):
        if isinstance(body, dict):
            body = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        if download:
            self.send_header(
                "Content-Disposition",
                f'attachment; filename="{download if isinstance(download, str) else "docx-ray-xml.zip"}"',
            )
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if urlsplit(self.path).path == "/api/health":
            self.respond(200, {"status": "ok", "version": "1.0.0", "maxUploadBytes": WEB_LIMITS.input_bytes})
        else:
            self.respond(404, {"error": "Route not found."})

    def do_POST(self):
        path = urlsplit(self.path).path
        if path not in ("/api/inspect", "/api/export", "/api/part"):
            return self.respond(404, {"error": "Route not found."})
        if self.headers.get("Content-Type", "").split(";")[0] != "application/octet-stream":
            return self.respond(415, {"error": "Send raw DOCX bytes as application/octet-stream."})
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return self.respond(400, {"error": "Invalid Content-Length."})
        if not 0 < length <= WEB_LIMITS.input_bytes:
            return self.respond(413, {"error": "Upload limit is 3 MB. Use the offline CLI for larger documents."})
        try:
            data = self.rfile.read(length)
            if len(data) != length:
                raise DocxError("Incomplete upload.")
            filename = unquote(self.headers.get("X-Filename", "document.docx"))
            if path == "/api/part":
                part_path = parse_qs(urlsplit(self.path).query).get("path", [""])[0]
                return self.respond(
                    200, xml_part(data, part_path, filename), "application/xml", download="xml-part.xml"
                )
            if path == "/api/export":
                return self.respond(200, xml_bundle(data, filename), "application/zip", download=True)
            self.respond(200, inspect_docx(data, filename))
        except DocxError as exc:
            self.respond(422, {"error": str(exc)})

    def do_PUT(self):
        self.respond(405, {"error": "Method not allowed."})

    do_DELETE = do_PATCH = do_PUT
