# flexmassage

Samlar alla lediga tider hos Flexmassage (baraboka.se) för utvalda mottagningar
på en filtrerbar sida. Tiderna hämtas om var 30:e minut.

- `flexmassage_tider.py` hämtar tiderna och bygger `lediga_tider.html` från `mall.html`.
- `server.py` visar sidan på port 8000 och kör hämtningen i bakgrunden.
- `/status` visar när senaste hämtningen lyckades. `/healthz` visar samma sak och
  svarar 503 om datamappen inte går att skriva. `/api/version` → `{version, built}`.

Bokningen görs alltid på baraboka.se, så en tid som hunnit bokas går inte att boka igen.

## Run
```bash
python3 flexmassage_tider.py          # en hämtning, skriver filerna här
OUT_DIR=./data python3 server.py      # server på http://localhost:8000
```

## Development standards
```bash
python3 -B -m unittest discover -s tests   # rökprov mot fejkad data, rör aldrig baraboka.se
```

- Standarden: `~/Documents/app-arkitektur.md` (avsnitt 7 är kontraktet).
  Designsystemet: `~/other-sync/Claude/designsystem/README.md`; `ds/` ändras bara där.
- CI-grinden (`.github/workflows/ci.yml`): `py_compile`, `unittest`, `ds/MANIFEST`. Rött = ingen image.
- Compose har bara env-namn (`${VAR:-…}`), aldrig hemligheter; Actions är SHA-pinnade.
- Beslut i `docs/DESIGN.md`, regler för agenter i `CLAUDE.md`.

## Inställningar (miljövariabler)

| Variabel | Standard | |
|---|---|---|
| `MOTTAGNINGAR` | Götaplatsen, Almedal, Mölndals Centrum, Pedagogen Park Mölndal | kommaseparerade namn som på baraboka.se |
| `DAGAR` | 14 | hur långt fram att hämta |
| `INTERVALL_MIN` | 30 | minuter mellan hämtningar |
| `PORT` | 8000 | |

## Deploy

Push till `main` → CI kör grinden → bygger imagen (bara amd64) → `watchtower-snabb`
rullar ut den inom fem minuter (containern står i dess namnlista).

Stacken `flexmassage (84)` på docker-local (VM 104, 10.20.2.101). Ändrad compose eller env går ut med
`~/other-sync/Claude/docker-local/deploy/deploy.py flexmassage --dry-run` och sedan utan
`--dry-run`; hemligheterna står i stackens env (eller hämtas ur valvet via `apps.toml`).

Bara hemma: `flexmassage.other.nu` i lokala NPM (värd 39 → `flexmassage:8000` på `edge`)
och värdport 8791. Containern kör som uid 10001 och skriver bara i `/app/data`.

## Architecture

`server.py` (standardbibliotekets `http.server`, port 8000) serverar sidan och
`/healthz` + `/api/version`; `flexmassage_tider.py` hämtar lediga tider var
`INTERVALL_MIN` minut och skriver resultatet i `/app/data`. Inga beroenden utanför
Pythons standardbibliotek; UI:t bygger på designsystemet i `ds/`.
