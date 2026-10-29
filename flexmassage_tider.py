#!/usr/bin/env python3
"""Hämtar alla lediga tider hos Flexmassage (baraboka.se) för alla mottagningar,
behandlingar och massörer, och skriver dem till flexmassage_tider.json
samt en filtrerbar sida, lediga_tider.html (byggd från mall.html), i OUT_DIR.

Miljövariabler: MOTTAGNINGAR (kommaseparerade namn), DAGAR, OUT_DIR.

Användning: python3 flexmassage_tider.py [antal_dagar] [--alla]
  antal_dagar  hur långt fram att hämta (standard 14)
  --alla       hämta alla mottagningar, inte bara de i MOTTAGNINGAR
"""
import datetime as dt
import html
import http.client
import http.cookiejar
import json
import os
import re
import ssl
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

BASE = "https://baraboka.se/flexmassage/mobil-new/"
ARGS = [a for a in sys.argv[1:] if not a.startswith("--")]
DAYS = int(ARGS[0]) if ARGS else int(os.environ.get("DAGAR", 14))
MOTTAGNINGAR = [m.strip().upper() for m in os.environ.get(
    "MOTTAGNINGAR", "GÖTAPLATSEN,ALMEDAL,MÖLNDALS CENTRUM,PEDAGOGEN PARK MÖLNDAL").split(",") if m.strip()]
HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.environ.get("OUT_DIR", HERE)
WORKERS = 4
CTX = ssl.create_default_context(cafile="/etc/ssl/cert.pem" if os.path.exists("/etc/ssl/cert.pem") else None)


def strip(s):
    s = re.sub(r"<script.*?</script>|<style.*?</style>", "", s, flags=re.S)
    return " ".join(html.unescape(re.sub(r"<[^>]+>", " ", s)).split())


class Session:
    def __init__(self):
        self.op = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()),
            urllib.request.HTTPSHandler(context=CTX))
        self.op.addheaders = [("User-Agent", "Mozilla/5.0")]

    def open(self, path, body=None):
        for attempt in range(4):
            try:
                return self.op.open(BASE + path, body, timeout=30).read().decode("utf-8", "replace")
            except (OSError, http.client.HTTPException):
                if attempt == 3:
                    raise
                time.sleep(2 * (attempt + 1))

    def get(self, path):
        return self.open(path)

    def post(self, path, data):
        return self.open(path, urllib.parse.urlencode(data).encode())

    def set(self, **values):
        self.post("ajax/setvalues/set-single-values.ajax.php", values)


def list_locations():
    s = Session().get("index.php")
    out = []
    parts = re.split(r'<div class="locations-box locations-box-common"', s)[1:]
    for p in parts:
        m = re.search(r"locationID':'(\d+)'", p)
        name = re.search(r"<strong[^>]*>(.*?)</strong>", p, re.S)
        text = strip(p)
        out.append({"id": m.group(1), "name": strip(name.group(1)) if name else text.split()[0]})
    return out


SLOT = re.compile(r'id="time_(\d{8})_(\d\d)_(\d\d)_(\d\d)_(\d\d)_\d+_(\d+)_\w+"')
OTHER = re.compile(r"""id="time_(\d+)_\d+" action""")


def parse_slots(page):
    names = {k: v for v, k in re.findall(r'data-staffname="([^"]*)" id="staff_name(\w+)"', page)}
    for m in SLOT.finditer(page):
        d, h, mi, eh, emi, staff = m.groups()
        key = m.group(0)[len('id="time_'):-1]
        yield (f"{d[:4]}-{d[4:6]}-{d[6:]}", f"{h}:{mi}", f"{eh}:{emi}",
               html.unescape(names.get(key) or names.get(re.sub(r"s\d$", "", key)) or staff))


def fetch_location(loc, end):
    """En session per mottagning. Hämtar först en behandling per 4-dagarsfönster; svaret
    listar vilka andra behandlingar som har lediga tider de dagarna, och bara de hämtas."""
    ses = Session()
    ses.get("index.php")
    ses.set(locationID=loc["id"])
    page = ses.get("index.php?days=")
    services = {}
    for m in re.finditer(r"""<span class="servicename"[^>]*serviceID': '(\d+)'.*?>(.*?)</span>""", page, re.S):
        services.setdefault(m.group(1), strip(m.group(2)))
    if not services:
        return [], 0
    base = next(iter(services))
    ses.set(serviceID=base)
    ses.set(staffID=0)
    ses.get("index.php")
    current, requests, out = base, 0, set()

    def window(sid, start):
        nonlocal current, requests
        if sid != current:
            ses.set(serviceID=sid)
            current = sid
        requests += 1
        return ses.post("includes/pages/refresh-display/load-selected-day.ajax.php",
                        {"daterequest": start.isoformat(), "days": 0})

    day = dt.date.today()
    while day <= end:
        page = window(base, day)
        out |= {(base,) + x for x in parse_slots(page)}
        for sid in dict.fromkeys(OTHER.findall(page)):
            if sid != base and sid in services:
                out |= {(sid,) + x for x in parse_slots(window(sid, day))}
        blocks = re.findall(r'id="day_block_(\d\d)_(\d\d)_(\d\d)"', page)
        last = max((dt.date(2000 + int(y), int(mo), int(dd)) for y, mo, dd in blocks), default=day)
        day = max(last, day) + dt.timedelta(days=1)
    rows = [{"mottagning": loc["name"], "behandling": services[sid], "datum": d, "start": s,
             "slut": e, "massor": st} for sid, d, s, e, st in out if d <= end.isoformat()]
    return rows, requests


def main():
    t0 = time.time()
    end = dt.date.today() + dt.timedelta(days=DAYS - 1)
    locs = list_locations()
    if "--alla" not in sys.argv:
        locs = [l for l in locs if l["name"] in MOTTAGNINGAR]
    print(f"{len(locs)} mottagningar, hämtar {DAYS} dagar framåt (t.o.m. {end})", file=sys.stderr)
    results, total, failed = [], 0, []
    with ThreadPoolExecutor(WORKERS) as ex:
        futures = {ex.submit(fetch_location, loc, end): loc for loc in locs}
        for fut in as_completed(futures):
            loc = futures[fut]
            try:
                rows, n = fut.result()
            except Exception as e:
                failed.append(loc["name"])
                print(f"  {loc['name']}: MISSLYCKADES ({e!r})", file=sys.stderr, flush=True)
                continue
            results += rows
            total += n
            print(f"  {loc['name']}: {len(rows)} tider ({n} anrop)", file=sys.stderr, flush=True)
    results.sort(key=lambda r: (r["datum"], r["start"], r["mottagning"], r["behandling"]))
    data = {"hamtat": dt.datetime.now().isoformat(timespec="minutes"), "dagar": DAYS, "misslyckade": failed,
            "server": os.environ.get("SERVER") == "1", "tider": results}
    write_atomic("flexmassage_tider.json", json.dumps(data, ensure_ascii=False, indent=1))
    build_page(data)
    print(f"{len(results)} lediga tider sparade i flexmassage_tider.json och lediga_tider.html "
          f"({total} anrop, {time.time() - t0:.0f} s)", file=sys.stderr)
    return data


def write_atomic(name, text):
    os.makedirs(OUT_DIR, exist_ok=True)
    tmp = os.path.join(OUT_DIR, name + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
    os.replace(tmp, os.path.join(OUT_DIR, name))


def build_page(data):
    page = open(os.path.join(HERE, "mall.html"), encoding="utf-8").read()
    blob = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    page = re.sub(r"/\*DATA\*/.*?/\*END\*/", lambda m: "/*DATA*/" + blob + "/*END*/", page, flags=re.S)
    write_atomic("lediga_tider.html", page)


if __name__ == "__main__":
    main()
