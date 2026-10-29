# Handover: deploy flexmassage i Portainer

**Mål:** köra `ghcr.io/ottoherdy/flexmassage:latest` som en Portainer-stack bakom
Nginx Proxy Manager, så att Otto får en sida med lediga massagetider som
uppdateras var 30:e minut.

## Läge

- Repo: https://github.com/ottoherdy/flexmassage (publikt, branch `main`).
- Image: `ghcr.io/ottoherdy/flexmassage:latest`, byggd av GitHub Actions
  (amd64 + arm64). **Publik**, anonym pull verifierad (HTTP 200). Ingen
  registry-inloggning behövs.
- Testat: Python-servern lokalt (en hämtning: 972 tider på 94 s, sidan renderar
  rätt). **Containern själv är inte körd någonstans än** (ingen Docker på Ottos Mac).
- Inget är deployat i Portainer.

## Vad containern gör

- `server.py` lyssnar på **port 8080**, visar sidan på `/`, data på
  `/flexmassage_tider.json`, och `/status` (även `/healthz`) med senaste
  lyckade/misslyckade hämtning. Allt annat ger 404.
- Hämtar från baraboka.se direkt vid start och sedan var `INTERVALL_MIN`
  minut. Första hämtningen tar ~1,5–2 min; under tiden visas en väntesida som
  laddar om sig själv.
- Skriver till `/app/data` inne i containern (ingen volym behövs, datan
  återskapas vid start). Kör som uid 1000. TZ `Europe/Stockholm`.
- Har en Docker HEALTHCHECK mot `/healthz`.
- Behöver utgående HTTPS till `baraboka.se`.

## Miljövariabler

| Variabel | Standard | |
|---|---|---|
| `INTERVALL_MIN` | 30 | minuter mellan hämtningar |
| `DAGAR` | 14 | hur långt fram att hämta |
| `MOTTAGNINGAR` | `GÖTAPLATSEN,ALMEDAL,MÖLNDALS CENTRUM,PEDAGOGEN PARK MÖLNDAL` | kommaseparerade namn exakt som på baraboka.se |
| `PORT` | 8080 | |

## Att göra

1. **Ta reda på NPM:s Docker-nätverk** (Portainer → Networks; samma som
   `otodo` och `choreboard` sitter på). Otto har inte angett det.
2. **Skapa stacken:** Stacks → Add stack → namn `flexmassage` → Web editor →
   innehållet i [`docs/portainer-stack.yml`](portainer-stack.yml). Ersätt
   `REPLACE_WITH_YOUR_NPM_NETWORK` med nätverksnamnet från steg 1. (Alternativ
   om nätverk inte passar: ta bort `networks`-blocken och avkommentera
   `ports: "8791:8080"`.) Deploy.
3. **Verifiera:** containerloggen ska visa `Lyssnar på :8080 …` och efter
   ~2 min en rad `… lediga tider sparade … (N anrop, S s)`. `/status` ska visa
   `senast_ok=<tid>`.
4. **NPM Proxy Host:** Forward Hostname `flexmassage`, port `8080` (eller
   värdens IP och `8791`), Block Common Exploits på, Let's Encrypt + Force SSL.
   **Domän: fråga Otto**, ingen är bestämd. Inga websockets behövs.
5. **Valfritt:** skapa en webhook på stacken och lägg URL:en som secret
   `PORTAINER_WEBHOOK` i GitHub-repot, så redeployas stacken automatiskt vid
   push till `main` (workflowen hoppar över steget om secreten saknas).

## Fallgropar

- Om loggen visar `MISSLYCKADES` för en mottagning har baraboka.se strulat
  (de har varit långsamma ibland och avbrutit svar). Skriptet gör 4 försök per
  anrop och fortsätter med övriga mottagningar; nästa körning brukar lyckas.
- `MOTTAGNINGAR` matchas mot namnen på baraboka.se i versaler. Ett felstavat
  namn ger tyst 0 mottagningar (loggen visar `0 mottagningar`).
- Var snäll mot baraboka.se: sänk inte `INTERVALL_MIN` under ~15.

## Rapportera tillbaka till Otto

URL:en till sidan, vilket nätverk eller vilken port du använde, och vad `/status` visar.
