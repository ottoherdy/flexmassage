"""Startar server.py med låtsasdata för designsystemets UI-kontroll (ds-check).
Hämtningen från baraboka.se körs aldrig; sidan byggs av den riktiga mallen.

  OUT_DIR=<tom katalog> PORT=8000 python3 tests/ds_check_server.py
"""
import functools
import http.server
import json
import os
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, ROOT)
sys.argv = sys.argv[:1]
import server  # noqa: E402
ft = server.ft

# Långa namn med flit: det är där en rad spiller över eller bryts.
TIDER = []
for i, (m, b, massor) in enumerate([
    ("GÖTAPLATSEN", "Klassisk massage 50 min", "Anna"),
    ("MÖLNDALS CENTRUM", "Idrottsmassage med stretching 80 min", "Maria-Theresia Lindqvist"),
    ("PEDAGOGEN PARK MÖLNDAL", "Gravidmassage 50 min", "Kim"),
    ("ALMEDAL", "Klassisk massage 25 min", "Johanna"),
] * 3):
    TIDER.append({"mottagning": m, "behandling": b, "datum": f"2026-11-{4 + i // 3:02d}",
                  "start": f"{9 + i % 8:02d}:00", "slut": f"{9 + i % 8:02d}:50", "massor": massor})
data = {"hamtat": "2026-11-04T08:00", "dagar": 14, "misslyckade": [], "server": True, "tider": TIDER}
os.makedirs(ft.OUT_DIR, exist_ok=True)
ft.write_atomic("flexmassage_tider.json", json.dumps(data, ensure_ascii=False))
ft.build_page(data)

handler = functools.partial(server.Handler, directory=ft.OUT_DIR)
http.server.ThreadingHTTPServer(("127.0.0.1", server.PORT), handler).serve_forever()
