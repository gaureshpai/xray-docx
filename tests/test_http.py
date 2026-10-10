import http.client
import json
import threading
import unittest
from http.server import ThreadingHTTPServer

from docx_ray.server import LocalHandler
from tests.test_engine import SAMPLE


class HttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), LocalHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def request(self, method, path, data=None, headers=None):
        client = http.client.HTTPConnection(*self.server.server_address, timeout=5)
        client.request(method, path, data, headers or {})
        response = client.getresponse()
        result = response.status, response.read(), dict(response.getheaders())
        client.close()
        return result

    def test_health(self):
        status, body, headers = self.request("GET", "/api/health")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["status"], "ok")
        self.assertEqual(headers["Cache-Control"], "no-store")

    def test_static_assets(self):
        for path in ["/", "/app.js", "/style.css", "/sample.docx"]:
            with self.subTest(path=path):
                self.assertEqual(self.request("GET", path)[0], 200)

    def test_inspect(self):
        status, body, _ = self.request(
            "POST", "/api/inspect", SAMPLE, {"Content-Type": "application/octet-stream", "X-Filename": "sample.docx"}
        )
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["summary"]["tables"], 1)

    def test_single_part(self):
        import io
        import zipfile

        status, body, _ = self.request(
            "POST", "/api/part?path=word/document.xml", SAMPLE, {"Content-Type": "application/octet-stream"}
        )
        self.assertEqual(status, 200)
        with zipfile.ZipFile(io.BytesIO(SAMPLE)) as archive:
            self.assertEqual(body, archive.read("word/document.xml"))

    def test_export(self):
        status, body, headers = self.request(
            "POST", "/api/export", SAMPLE, {"Content-Type": "application/octet-stream"}
        )
        self.assertEqual(status, 200)
        self.assertTrue(body.startswith(b"PK"))
        self.assertEqual(headers["Content-Type"], "application/zip")

    def test_reject_invalid(self):
        self.assertEqual(
            self.request("POST", "/api/inspect", b"bad", {"Content-Type": "application/octet-stream"})[0], 422
        )
        self.assertEqual(self.request("POST", "/api/inspect", SAMPLE, {"Content-Type": "text/plain"})[0], 415)
        self.assertEqual(
            self.request("POST", "/api/inspect", b"", {"Content-Type": "application/octet-stream"})[0], 413
        )
        self.assertEqual(self.request("POST", "/api/missing", b"bad")[0], 404)

    def test_no_static_traversal(self):
        self.assertEqual(self.request("GET", "/../pyproject.toml")[0], 404)

    def test_unsupported_method(self):
        self.assertEqual(self.request("PUT", "/api/inspect")[0], 405)
