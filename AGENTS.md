# AGENTS.md

Ohjeet ihmisille ja AI-koodausagenteille, jotka muokkaavat Opintodashboardia.
Lue ensin [docs/INDEX.md](docs/INDEX.md): siinä on arkkitehtuuri,
tietomalli, localStorage-avaimet, API-reitit ja Moodle-integraation
yksityiskohdat.

## Periaatteet

- **Ei riippuvuuksia.** Älä lisää npm-paketteja, build-työkaluja tai
  CDN-kirjastoja. Käytä Node.js:n omia moduuleja ja globaalia `fetch`:iä
  (Node 18+). Selaimessa vanilla-JS:ää.
- **`index.html` on yksi tiedosto.** CSS ja JS pysyvät sen sisällä. JS on
  yksi IIFE, näkymät reititetään hashilla (`route()`), ja `refresh()`
  rakentaa näkymän aina uudelleen tilasta.
- **Käyttöliittymä on suomeksi.** Uudet tekstit suomeksi ja lyhyesti.
- **`data.json` on kurssidatan ainoa lähde.** `data.js` generoidaan
  (`npm run build`), sitä ei koskaan muokata käsin. Käyttöliittymä ei
  kirjoita `data.json`:iin; käyttäjän omat merkinnät menevät
  localStorageen.
- **Kaikki toimii paikallisesti.** Ei ulkoisia palveluita ilman käyttäjän
  omaa avainta. Uudet integraatiot ovat valinnaisia ja epäonnistuvat
  hiljaa ilman, että muu toiminta kärsii (vrt. `estimate_deepseek.js`).

## Salaisuudet ja henkilötiedot

- Älä koskaan committaa: `.env`, `credentials.json`, `token.json`,
  `sync_state.json`, `data.json`, `data.js`, `deadline_scan.json`,
  `debug_*.html`. Ne ovat `.gitignore`:ssa; älä poista niitä sieltä.
- Älä kovakoodaa henkilökohtaisia arvoja (käyttäjä-id, tunnukset,
  kurssikohtaiset tiedot). Uudet asetukset lisätään `.env.example`:en,
  `server.js`:n `SETTINGS_KEYS`-listaan ja `index.html`:n
  `SETTINGS_GROUPS`:iin.
- `/api/settings/status` palauttaa vain totuusarvoja. Älä koskaan palauta
  tai lokita salaisuuksien arvoja, vain avainten nimiä.
- Lue `process.env` kutsuhetkellä, ei moduulin latautuessa: `server.js`
  lataa skriptit kerran, ja Asetuksista tallennetut arvot päivittyvät
  `process.env`:iin ajon aikana.

## Tunnetut sudenkuopat

- **Arvio ja tahti:** lue aina `getPlanHoursPace(item)`:lla, ei suoraan
  `item.estimatedHours`/`item.estimatedPace`. Käsin syötetyt arvot ovat
  `plan_v1`:ssä ja ohittavat datan arviot.
- **Päivämäärä:** käytä `effDate(item)`:ia, joka huomioi varatun
  EXAM-päivän.
- **Tallennusavaimet:** `itemKey()` (kurssi | päivä | otsikko) sitoo kaikki
  localStorage-merkinnät tehtävään. Sen muodon muuttaminen hävittää
  käyttäjien merkinnät. Jos localStorage-rakenne muuttuu, nosta avaimen
  versio (`_v2`) ja kirjoita migraatio.
- **DOM rakennetaan uudelleen:** jos syötekentän `onchange` kutsuu
  `refresh()`:iä, viivästä se (`setTimeout`), muuten samaan aikaan
  klikattu nappi katoaa alta.
- **Kalenterin palkit:** viikkorivien korkeudet asetetaan JS:ssä
  (`gridTemplateRows` renderöinnissä). Jos muutat `.calendar-bar`:n
  korkeutta CSS:ssä, päivitä myös rivikorkeus.
- **Tyylit:** käytä `:root`-muuttujia (`--card-bg`, `--accent`, ...),
  älä kovakoodattuja värejä. Tarkista sekä vaalea että tumma teema.
  Ikonit ovat inline-SVG:tä (`icon()`-apufunktio), ei emojeita.
- **Moodle:** sivujen rakenne on SAMK-kohtainen (ks. docs/INDEX.md). Moodlen
  ja SAMKin kirjautumispalvelun pitää olla tavoitettavissa, joten
  Moodle-skriptejä ei voi ajaa ympäristössä, jolla ei ole pääsyä
  `moodle5.samk.fi`:hin; testaa jäsennys tallennetulla HTML:llä
  (`debug_fetch_page.js`) tai mockatulla `fetch`:llä.
- **Windows:** käyttäjät ovat enimmäkseen Windowsilla. Älä käytä
  `cmd /c start`:ia URL:ien avaamiseen (katkaisee `&`-merkkiin), ja pidä
  `.bat`-tiedostot CRLF-muodossa ja ASCII-merkeissä.

## Testaus

Ennen committia:

1. Syntaksi: `node --check <tiedosto>.js` jokaiselle muutetulle
   skriptille. `index.html`:n JS: pura `<script>`-lohko erilliseen
   tiedostoon ja aja `node --check`.
2. Aja puhtaassa kopiossa `npm run setup` ja sitten
   `npm start -- --port 8181`, jolloin data tulee `data.example.json`:sta.
3. Käy läpi kaikki näkymät (Dashboard, Kalenteri, Viikko, Asetukset,
   kurssisivu) vaaleassa ja tummassa teemassa sekä noin 375 px leveällä
   näytöllä. Selaimen konsolissa ei saa olla virheitä.
4. Jos muutos koskee tallennusta, testaa myös sivun uudelleenlataus.

## Dokumentaatio

- `README.md` on lyhyt käyttöohje luokkalaisille. Pidä se lyhyenä.
- Tekniset yksityiskohdat kuuluvat `docs/INDEX.md`:hen, Google-ohje
  `docs/google-kalenteri.md`:hen.
- Päivitä ne samassa commitissa, jossa toiminta muuttuu.
