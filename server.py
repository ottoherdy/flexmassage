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

WAITING = """<!doctype html><html lang="sv"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta http-equiv="refresh" content="20"><title>Lediga massagetider</title>
<meta name="theme-color" content="#EFEFF2" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#17181A" media="(prefers-color-scheme: dark)">
<link rel="stylesheet" href="ds/tokens.css"><link rel="stylesheet" href="ds/base.css">
<link rel="stylesheet" href="ds/components.css">
<header class="head-wrap"><div class="head"><div class="brand"><span class="logo" aria-hidden="true"><svg viewBox="0 0 34 34" fill="none" stroke="currentColor"
stroke-width="2" stroke-linecap="round" style="width:22px;height:22px"><circle cx="17" cy="17" r="11"/><path d="M17 11v6l4 3"/></svg></span>
<span class="wordmark">Lediga tider</span></div></div></header>
<main class="page"><div class="card empty"><b>Hämtar tider…</b>
<p>Första hämtningen pågår och tar ett par minuter. Sidan laddas om av sig själv.</p></div></main>"""

# Design system files (ds/, copied in from ottoherdy/designsystem). Served from an
# exact allow-list of names, so no request path ever reaches the filesystem.
DS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ds")
DS_FILES = {
    "tokens.css": "text/css; charset=utf-8",
    "base.css": "text/css; charset=utf-8",
    "components.css": "text/css; charset=utf-8",
    "ds.js": "text/javascript; charset=utf-8",
}


class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path in ("/healthz", "/status"):
            body = (f"senast_ok={status['senast_ok']}\nsenast_fel={status['senast_fel']}\n"
                    f"pagar={status['pagar']}\n").encode()
            return self.reply(200, body, "text/plain; charset=utf-8")
        path = self.path.split("?")[0]
        if path.startswith("/ds/"):
            name = path[len("/ds/"):]
            if name not in DS_FILES:
                return self.reply(404, b"Finns inte", "text/plain; charset=utf-8")
            with open(os.path.join(DS_DIR, name), "rb") as f:
                return self.reply(200, f.read(), DS_FILES[name])
        if path in ("/", "/index.html"):
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
