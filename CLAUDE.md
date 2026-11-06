# flexmassage — regler för agenter

Lediga massagetider från baraboka.se på en sida; Python utan beroenden.

Läs först `README.md` och `docs/DESIGN.md`. Standarden: `~/Documents/app-arkitektur.md`
(avsnitt 7 är kontraktet).
Rör du UI: `~/other-sync/Claude/designsystem/README.md`; ändra aldrig i `ds/`.

## Bygg och testa (samma som CI-grinden)

```sh
python -m py_compile flexmassage_tider.py server.py
python -B -m unittest discover -s tests -v
(cd ds && sha256sum -c MANIFEST --quiet)
```

## Deploy

Push till `main` → CI → image → `watchtower-snabb`. Compose/env: `~/other-sync/Claude/docker-local/deploy/deploy.py flexmassage --dry-run`. Stacken `flexmassage` (84) på docker-local.

Ingen merge, ingen push till `main` och ingen deploy utan att Otto bett om det.

## Fällor

- Bara hemma (lokala NPM-värd 39 → `flexmassage:8000`).
- Var snäll mot baraboka.se: `INTERVALL_MIN` inte under ~15.
- `MOTTAGNINGAR` matchas i versaler; ett felstavat namn ger tyst 0 mottagningar.
- Inga hemligheter i git, inte heller i compose (bara env-namn). Tester med datum relativt till idag.
- Commit-författare `Otto Herdy <otto@herdy.se>`.
