"""Smoke test of server.py against a fake data file. Never contacts baraboka.se:
the refresh loop is not started and every fetch path is replaced by one that fails."""
import functools
import http.server
import json
import os
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
TMP = tempfile.TemporaryDirectory()
os.environ["OUT_DIR"] = TMP.name
sys.path.insert(0, ROOT)
# flexmassage_tider reads sys.argv at import (days as first argument); hide the
# test runner's arguments from it.
_argv, sys.argv = sys.argv, sys.argv[:1]
import server  # noqa: E402
sys.argv = _argv
ft = server.ft


def no_network(*a, **k):
    raise AssertionError("the smoke test must never contact baraboka.se")


ft.main = ft.Session = ft.list_locations = no_network


class Smoke(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        handler = functools.partial(server.Handler, directory=ft.OUT_DIR)
        cls.httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
        cls.base = f"http://127.0.0.1:{cls.httpd.server_address[1]}"
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        TMP.cleanup()

    def get(self, path):
        try:
            with urllib.request.urlopen(self.base + path, timeout=5) as r:
                return r.status, r.headers.get("Content-Type", ""), r.read()
        except urllib.error.HTTPError as e:
            return e.code, e.headers.get("Content-Type", ""), e.read()

    def write_fake_data(self):
        data = {"hamtat": "2026-11-03T08:00", "dagar": 14, "misslyckade": [], "server": True,
                "tider": [{"mottagning": "ALMEDAL", "behandling": "Klassisk massage 50 min",
                           "datum": "2026-11-04", "start": "09:00", "slut": "09:50", "massor": "Anna"}]}
        ft.write_atomic("flexmassage_tider.json", json.dumps(data, ensure_ascii=False))
        ft.build_page(data)  # the real page template, filled with the fake data

    def test_healthz_touches_disk(self):
        code, _, body = self.get("/healthz")
        self.assertEqual(code, 200)
        self.assertIn(b"data_skrivbar=True", body)

    def test_healthz_unwritable_is_503(self):
        real = ft.OUT_DIR
        ft.OUT_DIR = os.path.join(real, "finns-inte")
        try:
            self.assertEqual(self.get("/healthz")[0], 503)
        finally:
            ft.OUT_DIR = real

    def test_status_unchanged(self):
        code, _, body = self.get("/status")
        self.assertEqual(code, 200)
        self.assertTrue(body.startswith(b"senast_ok="))

    def test_version(self):
        code, ctype, body = self.get("/api/version")
        self.assertEqual(code, 200)
        self.assertIn("application/json", ctype)
        v = json.loads(body)
        self.assertEqual(set(v), {"version", "built"})
        self.assertTrue(v["version"])

    def test_page_and_data(self):
        self.write_fake_data()
        code, ctype, body = self.get("/")
        self.assertEqual(code, 200)
        self.assertIn("text/html", ctype)
        self.assertIn("Klassisk massage 50 min".encode(), body)
        code, ctype, body = self.get("/flexmassage_tider.json")
        self.assertEqual(code, 200)
        self.assertEqual(json.loads(body)["tider"][0]["mottagning"], "ALMEDAL")

    def test_design_system(self):
        code, ctype, body = self.get("/ds/tokens.css")
        self.assertEqual(code, 200)
        self.assertIn("text/css", ctype)

    def test_allow_list_is_strict(self):
        for path in ("/server.py", "/ds/../server.py", "/ds/MANIFEST", "/flexmassage_tider.json.tmp",
                     "/../etc/passwd", "/api/versions", "/data/"):
            self.assertEqual(self.get(path)[0], 404, path)


if __name__ == "__main__":
    unittest.main()
