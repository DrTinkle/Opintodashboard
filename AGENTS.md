# AGENTS.md

Ohjeet ihmisille ja AI-koodausagenteille, jotka muokkaavat Opintodashboardia.
Lue ensin [docs/INDEX.md](docs/INDEX.md): siinä on arkkitehtuuri,
tietomalli, localStorage-avaimet, API-reitit ja Moodle-integraation
yksityiskohdat.

## Periaatteet

- **Ei riippuvuuksia.** Älä lisää npm-paketteja, build-työkaluja tai
  CDN-kirjastoja. Käytä Node.js:n omia moduuleja ja globaalia `fetch`:iä
  (Node 18+). Selaimessa vanilla-JS:ää.
- **Kansiot:** `public/` (selaimelle tarjottavat), `src/` (koodi, `src/moodle/`
  ja `src/integrations/`), `data/` (käyttäjän omat tiedot), `debug/`,
  `docs/`. Kaikki tiedostopolut ovat `src/paths.js`:ssä: älä rakenna polkuja
  itse `__dirname`:sta. Palvelin tarjoaa vain `public/`-kansion.
- **`public/index.html` on yksi tiedosto.** CSS ja JS pysyvät sen sisällä. JS on
  yksi IIFE, näkymät reititetään hashilla (`route()`), ja `refresh()`
  rakentaa näkymän aina uudelleen tilasta.
- **Käyttöliittymä on suomeksi.** Uudet tekstit suomeksi ja lyhyesti.
- **`data/data.json` on kurssidatan ainoa lähde.** `public/data.js`
  generoidaan (`npm run build` tai koodissa `buildDataJs()` tiedostosta
  `src/build.js`), sitä ei koskaan muokata käsin. Käyttöliittymä ei
  kirjoita `data.json`:iin; käyttäjän omat merkinnät menevät
  localStorageen.
- **Kaikki toimii paikallisesti.** Ei ulkoisia palveluita ilman käyttäjän
  omaa avainta. Uudet integraatiot ovat valinnaisia ja epäonnistuvat
  hiljaa ilman, että muu toiminta kärsii (vrt. `estimate_deepseek.js`).

## Salaisuudet ja henkilötiedot

- Älä koskaan committaa: `.env`, `data/`-kansion omia tiedostoja
  (`data.json`, `credentials.json`, `token.json`, `sync_state.json`,
  `sync_report.json`, `deadline_scan.json`), `public/data.js` tai `debug/`.
  Ne ovat `.gitignore`:ssa; älä poista niitä sieltä.
- Älä kovakoodaa henkilökohtaisia arvoja (käyttäjä-id, tunnukset,
  kurssikohtaiset tiedot). Uudet asetukset lisätään `.env.example`:en,
  `src/server.js`:n `SETTINGS_KEYS`-listaan ja `public/index.html`:n
  `SETTINGS_GROUPS`:iin.
- `/api/settings/status` palauttaa vain totuusarvoja. Älä koskaan palauta
  tai lokita salaisuuksien arvoja, vain avainten nimiä.
- Lue `process.env` kutsuhetkellä, ei moduulin latautuessa: `src/server.js`
  lataa skriptit kerran, ja Asetuksista tallennetut arvot päivittyvät
  `process.env`:iin ajon aikana.

## Tunnetut sudenkuopat

- **Arvio ja tahti:** lue aina `getPlanHoursPace(item)`:lla, ei suoraan
  `item.estimatedHours`/`item.estimatedPace`. Käsin syötetyt arvot ovat
  `plan_v1`:ssä ja ohittavat datan arviot.
- **Päivämäärä:** käytä `effDate(item)`:ia, joka huomioi varatun
  EXAM-päivän.
- **Tallennusavaimet:** `itemKey()` (kurssi | päivä | otsikko) sitoo kaikki
  localStorage-merkinnät tehtävään. Jos synkka muuttaa deadlinen päivää,
  sen pitää lisätä vanha päivä `movedFrom`-listaan, jotta
  `migrateMovedDeadlines()` siirtää merkinnät. Sen muodon muuttaminen hävittää
  käyttäjien merkinnät. Jos localStorage-rakenne muuttuu, nosta avaimen
  versio (`_v2`) ja kirjoita migraatio.
- **Päivämäärät selaimessa:** siirrä päiviä `addDays()`:lla, älä
  `getTime() + n * 86400000`:lla (kesäaika siirtää tuloksen edelliselle
  päivälle). Moodlen ja opinto-oppaan tekstit ovat epäluotettavia: aseta ne
  `textContent`:lla, älä `innerHTML`:llä.
- **Tiedostojen kirjoitus:** kirjoita `data.json` `json_file.js`:n
  `readData()`/`writeData()`:lla (atominen, tarkistaa ettei tiedostoa ole
  muokattu välissä) ja muut tilatiedostot `writeJsonAtomic()`:lla.
- **Palvelimen suojaus:** uudet API-reitit lisätään `API_ROUTES`:iin, jolloin
  Host-, Origin- ja sisältötyyppitarkistukset koskevat niitä. Selaimen
  POST-kutsuissa pitää olla `Content-Type: application/json`.
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
  (`src/moodle/debug_fetch_page.js`, tallentaa `debug/`-kansioon) tai
  mockatulla `fetch`:llä.
- **Opinto-opas** (`samk_catalog.js`) käyttää dokumentoimatonta
  rajapintaa. Pidä se valinnaisena: virhe kirjataan synkan virheisiin eikä
  kaada mitään, ja vain puuttuvat kentät täytetään.
- **Synkan yhteenveto:** `src/moodle/sync_moodle.js`:n `summary`-kentät
  (`coursesScanned`, `dueFound`, `alreadyKnown`, `courses` ...) ja
  `public/index.html`:n `describeSync()` kuuluvat yhteen. Jos muutat toista,
  päivitä toinen. "0 uutta" ei saa koskaan näyttää onnistumiselta, jos
  mitään ei oikeasti tarkistettu.
- **Moodlen kieli:** hae Moodle-sivut aina `fetchMoodlePage()`:lla, joka
  pakottaa englannin (`lang=en`). Jäsennys olettaa englanninkieliset
  sivut; käyttäjien Moodle voi muuten olla suomeksi.
- **Windows:** käyttäjät ovat enimmäkseen Windowsilla. Älä käytä
  `cmd /c start`:ia URL:ien avaamiseen (katkaisee `&`-merkkiin), ja pidä
  `.bat`- ja `.ps1`-tiedostot CRLF-muodossa ja ASCII-merkeissä (Windows
  PowerShell 5 lukee BOM:ittoman tiedoston ANSI:na; ä-kirjain tehdään
  merkkikoodista `[char]0x00E4`). Sulkeet `if (...)`-lohkon sisällä
  olevassa `echo`-rivissä pitää escapeta (`^(`, `^)`). `paivita.bat` ajaa
  itsensä kopiona `%TEMP%`:stä, koska päivitys voi korvata sen kesken ajon.

## Testaus

Ennen committia:

1. Syntaksi: `node --check <tiedosto>.js` jokaiselle muutetulle
   skriptille. `public/index.html`:n JS: pura `<script>`-lohko erilliseen
   tiedostoon ja aja `node --check`.
2. Aja puhtaassa kopiossa `npm run setup` ja sitten
   `npm start -- --port 8181`, jolloin data tulee `data/data.example.json`:sta.
3. Käy läpi kaikki näkymät (Dashboard, Kalenteri, Viikko, Asetukset,
   kurssisivu) vaaleassa ja tummassa teemassa sekä noin 375 px leveällä
   näytöllä. Selaimen konsolissa ei saa olla virheitä.
4. Jos muutos koskee tallennusta, testaa myös sivun uudelleenlataus.
5. Moodle-synkan muutokset: aja synkka ja tarkista `data/sync_report.json`,
   jossa näkyy jokainen löydetty tehtävä ja mihin se täsmättiin.

## Dokumentaatio

- `README.md` on lyhyt käyttöohje luokkalaisille. Pidä se lyhyenä.
- Tekniset yksityiskohdat kuuluvat `docs/INDEX.md`:hen, Google-ohje
  `docs/google-kalenteri.md`:hen.
- Päivitä ne samassa commitissa, jossa toiminta muuttuu.
