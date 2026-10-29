# flexmassage

Samlar alla lediga tider hos Flexmassage (baraboka.se) för utvalda mottagningar
på en filtrerbar sida. Tiderna hämtas om var 30:e minut.

- `flexmassage_tider.py` hämtar tiderna och bygger `lediga_tider.html` från `mall.html`.
- `server.py` visar sidan på port 8080 och kör hämtningen i bakgrunden.
- `/status` visar när senaste hämtningen lyckades.

Bokningen görs alltid på baraboka.se, så en tid som hunnit bokas går inte att boka igen.

## Köra lokalt

```bash
python3 flexmassage_tider.py          # en hämtning, skriver filerna här
OUT_DIR=./data python3 server.py      # server på http://localhost:8080
```

## Inställningar (miljövariabler)

| Variabel | Standard | |
|---|---|---|
| `MOTTAGNINGAR` | Götaplatsen, Almedal, Mölndals Centrum, Pedagogen Park Mölndal | kommaseparerade namn som på baraboka.se |
| `DAGAR` | 14 | hur långt fram att hämta |
| `INTERVALL_MIN` | 30 | minuter mellan hämtningar |
| `PORT` | 8080 | |

## Deploy (Docker → ghcr → Portainer)

GitHub Actions bygger en multiarch-image (amd64 + arm64) och publicerar den till
`ghcr.io/ottoherdy/flexmassage`. Klistra in `docs/portainer-stack.yml` som en stack
i Portainer. Sätt secret `PORTAINER_WEBHOOK` i repot för automatisk redeploy.
