"""The local website server serves assets and has no conversion endpoint."""

import http.client
import threading
import unittest
from http.server import ThreadingHTTPServer

from xray_docx.server import LocalHandler


class StaticServerTests(unittest.TestCase):
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

    def request(self, method, path, data=None):
        client = http.client.HTTPConnection(*self.server.server_address, timeout=5)
        client.request(method, path, data)
        response = client.getresponse()
        result = response.status, response.read()
        client.close()
        return result

    def test_static_assets(self):
        for path in ["/", "/app.js", "/sdk-client.js", "/style.css", "/sample.docx"]:
            with self.subTest(path=path):
                self.assertEqual(self.request("GET", path)[0], 200)

    def test_no_conversion_api(self):
        self.assertEqual(self.request("GET", "/api/health")[0], 404)
        self.assertEqual(self.request("POST", "/api/inspect", b"not uploaded")[0], 501)

    def test_no_static_traversal(self):
        self.assertEqual(self.request("GET", "/../pyproject.toml")[0], 404)
