# flexmassage — design

Beslut och varför, nyaste överst. Det som är standard för alla appar står i
`~/Documents/app-arkitektur.md` och upprepas inte här.

## 2026-11-04 · Port 8000 i containern
Python-standarden. Värdporten 8791 är oförändrad; NPM-värd 39 pekar på `flexmassage:8000`.

## 2026-11-03 · Nås bara inifrån, ingen inloggning
Sidan visar bara lediga tider, så den ligger i lokala NPM utan Authelia och utan egen
inloggning.

## 2026-11-03 · Hjälpmedel i designsystemet
En skärm, gemensam neutral accent `#4F5A68`.

## Standardbiblioteket räcker
`http.server` och `urllib`, inga beroenden. Bokningen görs alltid på baraboka.se.

## Fallgropar
- `MISSLYCKADES` för en mottagning i loggen betyder att baraboka.se strulat (de är ibland
  långsamma och avbryter svar). Skriptet gör 4 försök per anrop och fortsätter med övriga
  mottagningar; nästa körning brukar lyckas.
- `MOTTAGNINGAR` matchas mot namnen på baraboka.se i versaler. Ett felstavat namn ger tyst
  0 mottagningar (loggen visar `0 mottagningar`).
- Var snäll mot baraboka.se: sänk inte `INTERVALL_MIN` under ~15.
