# Tekninen hakemisto

Tämä dokumentti kuvaa, miten Opintodashboard on rakennettu. Käyttöohjeet
ovat [README.md](../README.md):ssä ja koodin muokkaamisen säännöt
[AGENTS.md](../AGENTS.md):ssä.

## Sisältö

1. [Arkkitehtuuri](#arkkitehtuuri)
2. [Tiedostot](#tiedostot)
3. [Tietomalli: data.json](#tietomalli-datajson)
4. [Selaimen tallennus: localStorage](#selaimen-tallennus-localstorage)
5. [Palvelimen API](#palvelimen-api)
6. [Asetukset ja .env](#asetukset-ja-env)
7. [Skriptit ja komentorivi](#skriptit-ja-komentorivi)
8. [Laskentalogiikka](#laskentalogiikka)
9. [Moodle-integraatio](#moodle-integraatio)
10. [Google-synkka](#google-synkka)
11. [DeepSeek-arviot](#deepseek-arviot)
12. [Tunnetut rajoitukset](#tunnetut-rajoitukset)

## Arkkitehtuuri

```
Moodle ──(skriptit / Hae Moodlesta)──▶ data.json ──(build.js)──▶ data.js
                                                                    │
                   selain: index.html  ◀──── server.js (localhost) ─┘
                          │
                          └── localStorage (tilat, arviot, omat tehtävät ...)
```

- **Ei riippuvuuksia.** Kaikki on tehty Node.js:n omilla moduuleilla
  (`http`, `fs`, `path`, `child_process`) ja globaalilla `fetch`:llä
  (siksi Node 18+). Ei npm-paketteja, ei build-työkaluja.
- **`data.json` on kurssidatan ainoa totuus.** `build.js` kirjoittaa sen
  sisällön tiedostoon `data.js` muodossa `const COURSES = [...]`, jonka
  `index.html` lataa `<script src>`-tagilla.
- **`index.html` on koko käyttöliittymä:** yksi tiedosto, jossa CSS ja
  vanilla-JS (yksi IIFE). Hash-reititys: `#` (dashboard), `#kalenteri`,
  `#viikko`, `#asetukset`, `#kurssi/<id>`.
- **Käyttäjän omat merkinnät** (tilat, arviot, omat tehtävät, muokkaukset,
  piilotukset) ovat vain selaimen localStoragessa. `data.json`:ia ei
  koskaan muokata käyttöliittymästä, joten Moodle-synkka ei riko niitä.
- **`server.js`** tarjoaa staattiset tiedostot ja muutaman POST/GET-reitin,
  jotka ajavat skriptejä käyttäjän omalla koneella (jolla on pääsy
  Moodleen ja Googleen).

## Tiedostot

| Tiedosto | Tehtävä |
| --- | --- |
| `index.html` | Koko käyttöliittymä (HTML, CSS ja JS samassa tiedostossa) |
| `server.js` | Staattinen HTTP-palvelin + API-reitit, oletusportti 8080 |
| `build.js` | Generoi `data.js`:n `data.json`:sta |
| `setup.js`, `setup.bat`, `setup.sh` | Käyttöönotto: Node-tarkistus, omat tiedostot esimerkeistä, build |
| `load_env.js` | Pieni `.env`-lukija, jota kaikki skriptit käyttävät |
| `sync_moodle.js` | "Hae Moodlesta": uudet kurssit, sisältö ja deadlinet |
| `update_from_moodle.js` | Deadlinet Moodlen kalenterin ICS-viennistä |
| `scrape_course_content.js` | Kurssien aiheet ja materiaalit (`topics`) |
| `find_moodle_ids.js` | Täydentää kurssien `moodleId`:t profiilisivulta |
| `find_deadlines.js` | Skannaa tehtävien/tenttien sivut tiedostoon `deadline_scan.json` tarkistettavaksi |
| `refresh_moodle_session.js` | Automaattinen SAMK-kirjautuminen (Shibboleth), uusii `MOODLE_SESSION`:in |
| `estimate_deepseek.js` | Tuntiarvio uusille tehtäville DeepSeekin API:lla |
| `sync_to_google.js` | Vienti Google Tasksiin ja Google-kalenteriin |
| `debug_fetch_page.js` | Vianetsintä: tallentaa yhden Moodle-sivun raakana HTML:nä |
| `data.example.json` | Esimerkkidata, josta `setup.js` luo `data.json`:in |
| `.env.example` | Asetuspohja, josta `setup.js` luo `.env`:n |

Generoidut ja henkilökohtaiset tiedostot (`data.json`, `data.js`, `.env`,
`token.json`, `sync_state.json`, `credentials.json`, `deadline_scan.json`,
`debug_*.html`) ovat `.gitignore`:ssa.

## Tietomalli: data.json

`data.json` on taulukko kursseja.

**Kurssi**

| Kenttä | Tyyppi | Kuvaus |
| --- | --- | --- |
| `id` | string | Pysyvä tunniste, käytetään avaimena kaikkialla (esim. `"tito"`) |
| `name` | string | Kurssin nimi |
| `code` | string / null | Opintojaksokoodi |
| `credits` | number | Opintopisteet |
| `teacher` | string | Opettaja |
| `color` | string | Kurssin väri (`#rrggbb`) |
| `start`, `end` | `"YYYY-MM-DD"` | Kurssin kesto (etenemispalkki) |
| `moodleId` | number / null | Numero osoitteesta `course/view.php?id=` |
| `links` | `[{label, url}]` | Kurssikortin linkit |
| `topics` | `[{name, summary, items: [{title, url, type, content}]}]` | Moodlesta haettu sisältö |
| `needsInfo` | boolean | Synkan lisäämä kurssi, josta puuttuu tietoja |
| `deadlines` | taulukko | Ks. alla |

**Deadline**

| Kenttä | Tyyppi | Kuvaus |
| --- | --- | --- |
| `title` | string | Otsikko |
| `date` | `"YYYY-MM-DD"` | Määräaika |
| `type` | `"task"` / `"exam"` / `"lab"` / `"event"` | Tyyppi |
| `notes` | string | Lisätiedot (usein Moodlen kuvaus) |
| `estimatedHours` | number | Oletusarvio työmäärästä (h) |
| `estimatedPace` | number | Oletustahti (h/vko) |
| `examWindowStart`, `examWindowEnd` | `"YYYY-MM-DD"` | EXAM-varausikkuna |

Deadlinella ei ole omaa id:tä. Kaikki selaimen tallennus avataan
yhdistelmällä `kurssin id | päivä | otsikko` (ks. `itemKey()`
`index.html`:ssä). Omilla tehtävillä on oma `id`-kenttä, jota `itemKey()`
käyttää ensin.

Tyyppi `"examsys"` (EXAM) ei esiinny `data.json`:issa: `rebuildAllItems()`
luokittelee `exam`-kohteen ajon aikana EXAMiksi, kun sillä on
varausikkuna ja kurssin Tentti-valinta on (tai oletuksena olisi)
EXAM-järjestelmä.

Käsin muokkauksen jälkeen aja `npm run build` ja lataa sivu uudelleen.

## Selaimen tallennus: localStorage

Kaikki avaimet alkavat `opintodashboard_` ja päättyvät versioon `_v1`.

| Avain | Sisältö |
| --- | --- |
| `status_v1` | Tehtävän tila: `kesken`, `tehty`, `ei-tehda`, `poistettu` (puuttuva = avoin) |
| `done_v1` | Vanha tehty-merkintä, migroidaan `status_v1`:een |
| `progress_v1` | Työn alla -tehtävän valmiusprosentti |
| `plan_v1` | Käsin syötetyt Arvio (h) ja Tahti (h/vko), ohittavat `data.json`:in arviot |
| `edits_v1` | Moodle-tehtävien muokkaukset (otsikko, päivä, tyyppi, muistiinpanot) |
| `custom_v1` | Omat tehtävät |
| `exam_v1` | Kurssin Tentti-valinta, "suoritettava viimeistään" ja varattu EXAM-päivä |
| `course_state_v1` | Kurssin tila: `completed` tai `hidden` |
| `capacity_v1` | Viikkonäkymän opiskeluaika viikonpäivittäin |
| `nostudy_v1` | "Ei opiskella" -päivät |
| `last_sync_v1`, `last_google_sync_v1` | Viimeisimmän synkan aikaleima |

## Palvelimen API

| Reitti | Tehtävä |
| --- | --- |
| `POST /api/sync-moodle` | Ajaa `sync_moodle.js`:n `runSync()`:n. Yksi ajo kerrallaan (lukko). Palauttaa yhteenvedon. |
| `POST /api/sync-google` | Ajaa `sync_to_google.js`:n `main()`:n oletusasetuksilla (komentoriviliput eivät vaikuta) |
| `GET /api/settings/status` | Kertoo vain, onko kukin asetus asetettu (`true`/`false`). Arvoja ei koskaan palauteta. |
| `POST /api/settings` | `{ set: {KEY: arvo}, clear: [KEY] }`. Kirjoittaa vain muuttuneet rivit `.env`:iin ja päivittää käynnissä olevan palvelimen `process.env`:n. |

Kaikki muut polut tarjotaan staattisina tiedostoina (polun ohitus estetty
`safeJoin()`:lla). Välimuisti on pois päältä, jotta `data.js`:n muutos
näkyy heti uudelleenlatauksella.

## Asetukset ja .env

| Avain | Käyttö |
| --- | --- |
| `MOODLE_USERNAME`, `MOODLE_PASSWORD` | Automaattinen kirjautuminen (`refresh_moodle_session.js`) |
| `MOODLE_SESSION` | Moodlen istuntoeväste; uusitaan automaattisesti, jos tunnukset on asetettu |
| `MOODLE_USERID` | Oma käyttäjä-id, tarvitaan profiilisivun kurssilistaan |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google OAuth -asiakas |
| `DEEPSEEK_API_KEY` | Valinnainen tuntiarvioihin |

`load_env.js` ei ylikirjoita jo asetettuja ympäristömuuttujia, joten oikea
ympäristömuuttuja voittaa `.env`:n.

## Skriptit ja komentorivi

Kaikki Moodle-skriptit lukevat kirjautumisen `.env`:stä ja uusivat
evästeen tarvittaessa automaattisesti.

```
npm start                                  # node server.js [--port 3000]
npm run build                              # data.json -> data.js
npm run sync:moodle                        # node sync_moodle.js [--delay 500] [--userid N]
npm run sync:google                        # ks. docs/google-kalenteri.md
npm run find-ids                           # node find_moodle_ids.js [--dry-run] [--userid N]

node update_from_moodle.js --url "<ICS-vientilinkki>" [--dry-run]
node update_from_moodle.js --file kalenteri.ics
node scrape_course_content.js [--course <moodleId>] [--dry-run] [--debug] [--delay ms]
node find_deadlines.js [--course=<id>] [--delay=ms]
node refresh_moodle_session.js [--dry-run] [--debug]
```

`find_moodle_ids.js` ja `scrape_course_content.js` hyväksyvät myös
`--session "<MoodleSession>"` ja `--base-url` (oletus
`https://moodle5.samk.fi`).

ICS-vientilinkki löytyy Moodlesta: Kalenteri > Vie kalenteri > Hae
vientilinkki. Linkin `authtoken`-parametri on salainen.

## Laskentalogiikka

- **Tehokas päivämäärä** (`effDate()`): deadlinen päivä, tai varattu
  EXAM-päivä, jos se on merkitty kurssin Tentti-laatikkoon.
- **Arvio ja tahti** (`getPlanHoursPace()`): käsin syötetty arvo
  (`plan_v1`) ensin, muuten `data.json`:in `estimatedHours`/`estimatedPace`.
  Kaikki laskenta käyttää tätä funktiota.
- **Aloita viimeistään** (`computeStartByDate()`):
  `effDate - round(arvio / tahti × 7)` päivää. Ei näytetä myöhässä-leimaa
  Työn alla- tai Tehty-tehtäville.
- **Viikkonäkymä** (`computeWeekAllocation()`): ahne jako tästä päivästä
  60 päivää eteenpäin. Mukana tehtävät, joiden aloituspäivä on tänään tai
  mennyt, sekä kaikki Työn alla -tehtävät. Aikaisin deadline ensin; päivä
  täytetään kapasiteettiin asti ennen seuraavaa tehtävää. Tulevan
  deadlinen jälkeen ei jaeta tunteja, mutta jo myöhässä olevat tehtävät
  jaetaan normaalisti ensimmäisinä.
- **EXAM-varattavuus:** ajat avautuvat noin 30 vrk etukäteen
  (`EXAM_BOOKING_HORIZON_DAYS`).

## Moodle-integraatio

- **Kirjautuminen:** SAMK käyttää Shibboleth-SSO:ta (idp.samk.fi).
  `refresh_moodle_session.js` toimii raakana HTTP-asiakkaana: evästepurkki
  domainia kohden, seuraa automaattisesti lähettyviä välilomakkeita
  (myös "Loading Session Information" -välivaihe) ja lukee
  `<button name="_eventId_proceed">`-kentän lomakkeelta. Ei kaksivaiheista
  tunnistautumista. Jos SAMK muuttaa kirjautumista, aja `--debug`.
- **Kurssien sisältö:** SAMKin kursseilla on "tabs"-muoto, jossa jokainen
  aihe on oma sivunsa (`course/view.php?id=X&section=N`). Aiheiden lista
  luetaan välilehtipalkista, piilotetut aiheet ohitetaan.
- **Kurssilista:** profiilisivulta `user/profile.php?id=<userid>&showallcourses=1`
  (linkit `user/view.php?...&course=<id>`). Kurssit täsmätään nimen
  perusteella sumealla vertailulla.
- **Deadlinet:** tehtäväsivun `data-region="activity-dates"` sisältää
  "Opened:"/"Due:"-rivit englanniksi. Monella quiz-tyyppisellä
  harjoituksella ei ole muodollista määräaikaa; sellaiset jätetään
  lisäämättä.
- **Duplikaatit:** otsikot verrataan merkitsevien sanojen perusteella
  (`isSameDeadline()`); pelkät numerot säilytetään aina, jotta
  "Viikkotehtävä 1" ja "Viikkotehtävä 2" eivät sekoitu.
- **Roskakurssit:** esim. "Library Moodle" näkyy profiilin kurssilistassa;
  piilota se kurssikortista.

## Google-synkka

- `task` menee Google Tasksiin, muut tyypit Google-kalenteriin koko päivän
  tapahtumina.
- Jokainen deadline saa muistutustapahtuman edellisenä päivänä
  (`REMINDER_TIME_START`), EXAM-ikkunat varauksen avautumispäivänä.
- OAuth2-kirjautuminen omalla loopback-toteutuksella, `token.json`
  uusiutuu automaattisesti. Windowsilla selain avataan
  `rundll32 url.dll,FileProtocolHandler`:llä, koska `cmd /c start`
  katkaisee URL:n `&`-merkkiin.
- Idempotentti: `sync_state.json` muistaa, mikä deadline vastaa mitäkin
  Google-merkintää.

## DeepSeek-arviot

- Kutsutaan vain aidosti uusille tehtäville synkan hetkellä, ei koskaan
  uudelleen.
- `deepseek-chat`, JSON-vastaus `{estimatedHours, estimatedPace}`.
- Mikä tahansa virhe (ei avainta, verkko, virheellinen vastaus,
  epäuskottavat luvut) ohittaa arvion; tehtävä lisätään silti.

## Tunnetut rajoitukset

- localStorage ei synkronoidu laitteiden tai selainten välillä.
- Deadlinen poistaminen ei poista sen Google-merkintää.
- Tehtävän nimi linkittää kurssin Moodle-etusivulle, ei suoraan
  tehtävään (aktiviteetin id:tä ei tallenneta).
- Moodlen sivurakenteen muutos voi rikkoa jäsennyksen; käytä
  `debug_fetch_page.js`:ää vianetsintään.
- Kaikki Moodle-osoitteet olettavat SAMKin Moodlen (`moodle5.samk.fi`).
