#!/usr/bin/env python3
"""Visar lediga_tider.html på PORT och hämtar nya tider var INTERVALL_MIN:e minut.

Miljövariabler: PORT (8080), INTERVALL_MIN (30), OUT_DIR (/app/data) samt
MOTTAGNINGAR och DAGAR som skickas vidare till flexmassage_tider.py.
"""
import datetime as dt
import functools
import http.server
import os
import sys
import threading
import time
import traceback

os.environ.setdefault("OUT_DIR", "/app/data")
os.environ["SERVER"] = "1"
import flexmassage_tider as ft  # noqa: E402  (läser OUT_DIR vid import)

PORT = int(os.environ.get("PORT", 8080))
INTERVAL = float(os.environ.get("INTERVALL_MIN", 30)) * 60
status = {"senast_ok": None, "senast_fel": None, "pagar": False}

WAITING = """<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<meta http-equiv="refresh" content="20"><title>Lediga massagetider</title>
<body style="font-family:system-ui;padding:40px 20px;max-width:40em;margin:auto">
<h1>Hämtar tider…</h1><p>Första hämtningen pågår och tar ett par minuter. Sidan laddas om av sig själv.</p>"""


class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path in ("/healthz", "/status"):
            body = (f"senast_ok={status['senast_ok']}\nsenast_fel={status['senast_fel']}\n"
                    f"pagar={status['pagar']}\n").encode()
            return self.reply(200, body, "text/plain; charset=utf-8")
        if self.path.split("?")[0] in ("/", "/index.html"):
            page = os.path.join(ft.OUT_DIR, "lediga_tider.html")
            if not os.path.exists(page):
                return self.reply(200, WAITING.encode(), "text/html; charset=utf-8")
            self.path = "/lediga_tider.html"
        if self.path.split("?")[0] not in ("/lediga_tider.html", "/flexmassage_tider.json"):
            return self.reply(404, b"Finns inte", "text/plain; charset=utf-8")
        return super().do_GET()

    def reply(self, code, body, ctype):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      ".html": "text/html; charset=utf-8", ".json": "application/json; charset=utf-8"}

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *args):
        pass


def refresh_loop():
    while True:
        started = time.time()
        status["pagar"] = True
        try:
            ft.main()
            status["senast_ok"] = dt.datetime.now().isoformat(timespec="seconds")
        except Exception:
            status["senast_fel"] = dt.datetime.now().isoformat(timespec="seconds")
            traceback.print_exc()
        finally:
            status["pagar"] = False
        sys.stderr.flush()
        time.sleep(max(60, INTERVAL - (time.time() - started)))


if __name__ == "__main__":
    os.makedirs(ft.OUT_DIR, exist_ok=True)
    threading.Thread(target=refresh_loop, daemon=True).start()
    handler = functools.partial(Handler, directory=ft.OUT_DIR)
    print(f"Lyssnar på :{PORT}, hämtar var {INTERVAL / 60:.0f}:e minut till {ft.OUT_DIR}", file=sys.stderr, flush=True)
    http.server.ThreadingHTTPServer(("", PORT), handler).serve_forever()
