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
10. [SAMK opinto-opas](#samk-opinto-opas)
11. [Google-synkka](#google-synkka)
12. [DeepSeek-arviot](#deepseek-arviot)
13. [Tunnetut rajoitukset](#tunnetut-rajoitukset)

## Arkkitehtuuri

```
Moodle ──(skriptit / Hae Moodlesta)──▶ data/data.json ──(build)──▶ public/data.js
                                                                        │
               selain: public/index.html  ◀──── src/server.js (localhost) ─┘
                          │
                          └── localStorage (tilat, arviot, omat tehtävät ...)
```

- **Ei riippuvuuksia.** Kaikki on tehty Node.js:n omilla moduuleilla
  (`http`, `fs`, `path`, `child_process`) ja globaalilla `fetch`:llä
  (siksi Node 18+). Ei npm-paketteja, ei build-työkaluja.
- **`data/data.json` on kurssidatan ainoa totuus.** `buildDataJs()`
  (`src/build.js`) kirjoittaa sen sisällön tiedostoon `public/data.js`
  muodossa `const COURSES = [...]`, jonka `index.html` lataa
  `<script src>`-tagilla.
- **`public/index.html` on koko käyttöliittymä:** yksi tiedosto, jossa CSS
  ja vanilla-JS (yksi IIFE). Hash-reititys: `#` (dashboard), `#kalenteri`,
  `#viikko`, `#asetukset`, `#kurssi/<id>`.
- **Käyttäjän omat merkinnät** (tilat, arviot, omat tehtävät, muokkaukset,
  piilotukset) ovat vain selaimen localStoragessa. `data.json`:ia ei
  koskaan muokata käyttöliittymästä, joten Moodle-synkka ei riko niitä.
- **`src/server.js`** tarjoaa `public/`-kansion staattisina tiedostoina ja
  muutaman POST/GET-reitin, jotka ajavat skriptejä käyttäjän omalla
  koneella (jolla on pääsy Moodleen ja Googleen). Muut kansiot (`data/`,
  `.env`, `src/`) eivät ole haettavissa selaimesta.
- **Kaikki tiedostopolut ovat `src/paths.js`:ssä.** Skriptit eivät rakenna
  polkuja itse. Samassa tiedostossa on `migrateLegacyFiles()`, joka siirtää
  vanhan (kaikki juuressa) rakenteen omat tiedostot uusiin kansioihin;
  sitä kutsutaan `npm start`:n ja `npm run setup`:n yhteydessä.

## Tiedostot

```
.
├── README.md, AGENTS.md, package.json, .env.example
├── setup.bat, setup.sh          käyttöönotto (Windows / macOS, Linux)
├── .env                         omat asetukset (ei gitissä)
├── public/
│   ├── index.html               käyttöliittymä
│   └── data.js                  generoitu data.json:sta (ei gitissä)
├── data/
│   ├── data.example.json        esimerkkidata (gitissä)
│   └── ...                      omat tiedot (ei gitissä, ks. alla)
├── debug/                       vianetsinnän HTML-tallenteet (ei gitissä)
├── docs/
│   ├── INDEX.md, google-kalenteri.md
│   └── images/                  README:n kuvakaappaukset
└── src/
    ├── paths.js, load_env.js, build.js, setup.js, server.js
    ├── moodle/
    └── integrations/
```

| Tiedosto | Tehtävä |
| --- | --- |
| `public/index.html` | Koko käyttöliittymä (HTML, CSS ja JS samassa tiedostossa) |
| `src/server.js` | HTTP-palvelin (`public/`) + API-reitit, oletusportti 8080 |
| `src/paths.js` | Kaikki tiedostopolut ja vanhan rakenteen siirto |
| `src/build.js` | `buildDataJs()`: generoi `public/data.js`:n `data/data.json`:sta |
| `src/setup.js`, `setup.bat`, `setup.sh` | Käyttöönotto: Node-tarkistus, omat tiedostot esimerkeistä, build |
| `src/load_env.js` | Pieni `.env`-lukija, jota kaikki skriptit käyttävät |
| `src/moodle/sync_moodle.js` | "Hae Moodlesta": uudet kurssit, sisältö ja deadlinet |
| `src/moodle/update_from_moodle.js` | Deadlinet Moodlen kalenterin ICS-viennistä |
| `src/moodle/scrape_course_content.js` | Kurssien aiheet ja materiaalit (`topics`), Moodle-sivujen haku |
| `src/moodle/find_moodle_ids.js` | Täydentää kurssien `moodleId`:t profiilisivulta |
| `src/moodle/exam_windows.js` | Tentit kurssin Moodle-tekstistä: EXAM-ikkunat, paperi- ja luokkatentit (synkka käyttää) |
| `src/moodle/find_deadlines.js` | Skannaa tehtävien/tenttien sivut tiedostoon `data/deadline_scan.json` tarkistettavaksi |
| `src/moodle/refresh_moodle_session.js` | Automaattinen SAMK-kirjautuminen (Shibboleth), uusii `MOODLE_SESSION`:in |
| `src/moodle/debug_fetch_page.js` | Vianetsintä: tallentaa yhden Moodle-sivun `debug/`-kansioon |
| `src/integrations/samk_catalog.js` | Täydentää kurssien puuttuvat tiedot SAMKin julkisesta opinto-oppaasta |
| `src/integrations/estimate_deepseek.js` | Tuntiarvio uusille tehtäville DeepSeekin API:lla |
| `src/integrations/sync_to_google.js` | Vienti Google Tasksiin ja Google-kalenteriin |
| `data/data.example.json` | Esimerkkidata, josta setup luo `data/data.json`:in |
| `.env.example` | Asetuspohja, josta setup luo `.env`:n |

Omat tiedostot `data/`-kansiossa (kaikki `.gitignore`:ssa): `data.json`
(kurssit), `credentials.json` ja `token.json` (Google), `sync_state.json`
(Google-synkan tila), `sync_report.json` (viimeisin Moodle-synkka),
`deadline_scan.json` (`find_deadlines.js`:n tulos). Lisäksi
`.env`, `public/data.js` ja `debug/` ovat `.gitignore`:ssa.

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
| `moodleKeywords` | string[] (valinnainen) | Lisäsanat, joilla ICS-tuonti tunnistaa kurssin tapahtumat, esim. `["html ja css"]` |
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
| `moodleUrl` | string | Moodle-aktiviteetti, josta deadline on haettu (synkka asettaa) |

Deadlinella ei ole omaa id:tä. Kaikki selaimen tallennus avataan
yhdistelmällä `kurssin id | päivä | otsikko` (ks. `itemKey()`
`public/index.html`:ssä). Omilla tehtävillä on oma `id`-kenttä, jota `itemKey()`
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

Kaikki muut polut tarjotaan staattisina tiedostoina `public/`-kansiosta
(polun ohitus estetty `safeJoin()`:lla). Välimuisti on pois päältä, jotta `public/data.js`:n muutos
näkyy heti uudelleenlatauksella.

## Asetukset ja .env

| Avain | Käyttö |
| --- | --- |
| `MOODLE_USERNAME`, `MOODLE_PASSWORD` | Automaattinen kirjautuminen (`refresh_moodle_session.js`) |
| `MOODLE_SESSION` | Moodlen istuntoeväste; uusitaan automaattisesti, jos tunnukset on asetettu |
| `MOODLE_USERID` | Valinnainen: oma käyttäjä-id. Ilman sitä haetaan kirjautuneen käyttäjän oma profiili |
| `SAMK_GROUP` | Ryhmätunnus (esim. `AIC25SP`), opinto-oppaan toteutuksen valintaan |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google OAuth -asiakas |
| `DEEPSEEK_API_KEY` | Valinnainen tuntiarvioihin |

`load_env.js` ei ylikirjoita jo asetettuja ympäristömuuttujia, joten oikea
ympäristömuuttuja voittaa `.env`:n.

## Skriptit ja komentorivi

Kaikki Moodle-skriptit lukevat kirjautumisen `.env`:stä ja uusivat
evästeen tarvittaessa automaattisesti.

```
npm start                                  # node src/server.js [--port 3000]
npm run build                              # data/data.json -> public/data.js
npm run sync:moodle                        # node src/moodle/sync_moodle.js [--delay 500] [--userid N]
npm run sync:google                        # ks. docs/google-kalenteri.md
npm run find-ids                           # node src/moodle/find_moodle_ids.js [--dry-run] [--userid N]
npm run catalog                            # node src/integrations/samk_catalog.js [--dry-run]

node src/moodle/update_from_moodle.js --url "<ICS-vientilinkki>" [--dry-run] [--debug]
node src/moodle/update_from_moodle.js --file kalenteri.ics
node src/moodle/scrape_course_content.js [--course <moodleId>] [--dry-run] [--debug] [--delay ms]
node src/moodle/find_deadlines.js [--course=<id>] [--delay=ms]
node src/moodle/refresh_moodle_session.js [--dry-run] [--debug]
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
- **Kurssilista:** omalta profiilisivulta `user/profile.php?showallcourses=1`
  (ilman id:tä Moodle näyttää kirjautuneen käyttäjän profiilin;
  `MOODLE_USERID` antaa id:n tarvittaessa, ja id tunnistetaan sivulta
  varalla, jos kursseja ei löydy)
  (linkit `user/view.php?...&course=<id>`). Kurssit täsmätään nimen
  perusteella sumealla vertailulla.
- **Kieli:** Moodle näyttää sivut istunnon tai tilin kieliasetuksen mukaan
  (skripti ei lähetä selaimen kieltä), joten `fetchMoodlePage()` lisää
  jokaiseen pyyntöön `lang=en`. Näin sivut ovat kaikilla englanniksi, ja
  jäsennys (päivämäärät, otsikot) toimii samoin kaikille.
- **Deadlinet:** tehtäväsivun `data-region="activity-dates"` sisältää
  "Opened:"/"Due:"-rivit. Aikaikkunallisilla harjoituksilla ja tenteillä
  (quiz) määräaika on "Closes:" tai jo mennyt "Closed:", ja sitä käytetään,
  jos "Due:"-riviä ei ole. Osalla quizeista ei ole kumpaakaan (esim.
  labrojen esityöt); sellaiset jätetään lisäämättä.
- **ICS-tuonnin kurssitunnistus** (`update_from_moodle.js`, `matchCourse()`)
  perustuu kokonaan `data.json`:iin, ei kovakoodattuihin kursseihin:
  1. kurssikoodi tai koko nimi tapahtuman CATEGORIES-kentässä (SAMKin
     Moodle laittaa sinne kurssin lyhytnimen, joka sisältää koodin),
  2. kurssin `moodleKeywords`,
  3. kurssin nimen sanat tapahtuman otsikossa. Sanan alkuosa riittää
     (taivutusmuodot), ja osuma hyväksytään, jos vähintään puolet nimen
     sanoista osuu tai osuu jokin pitkä, yksilöivä sana. Tasapelissä
     tapahtumaa ei liitetä mihinkään.

  Tunnistamattomat tapahtumat tulostetaan; `--debug` näyttää niiden
  kaikki kentät, ja korjaus on lisätä kurssille `moodleKeywords`.
- **Labrat:** tyypiksi tulee `lab`, jos kurssin nimessä on "laboraatio"
  tai "labra" tai tehtävän otsikossa "labra".
- **Tekstissä kerrotut tentit** (`exam_windows.js`): Moodle-quizina
  toteutetut tentit löytyvät "Closes:"-päivästä kuten muutkin quizit. Muut
  tentit ovat vain kurssin tekstissä: EXAM-järjestelmä (exam5x.samk.fi) on
  Moodlesta erillinen, ja paperi- ja luokkatenttien päivä kirjoitetaan
  kurssisivulle. Synkka lukee osioiden kuvaukset, tekstit ja sivut ja
  poimii rivit, joilla (tai EXAM-linkin kohdalla edellisellä rivillä)
  mainitaan tentti ja on päivämäärä:
  - **Päivämääräväli** ("12.10.-1.11.2026", "7.–22.11.2026", kaksi täyttä
    päivää): EXAM-ikkuna, jos rivillä on EXAM-linkki tai kurssin tekstissä
    mainitaan EXAM. Siitä tulee "Tentti (EXAM-ikkuna)" ikkunan loppupäivälle
    `examWindowStart`/`End`-kenttien kanssa. Muuten tavallinen "Tentti"
    ikkunan loppupäivälle.
  - **Yksittäinen päivä** ("tentti suoritetaan paperille 14.10.2026"): tentti
    sinä päivänä. Ilman vuotta ("14.10.") vuosi päätellään kurssin
    alkupäivästä.
  - Ohitetaan uusintatentit sekä ilmoittautumis- ja avautumispäivät. Jo
    listalla oleva tunnistetaan samasta EXAM-ikkunasta tai tentistä samana
    päivänä. Jos päivää ei ole kirjoitettu Moodleen, tenttiä ei löydy.
- **Duplikaatit:** synkan lisäämä deadline tallentaa aktiviteettinsa
  osoitteen (`moodleUrl`) ja täsmää jatkossa vain siihen. Käsin lisätyt
  verrataan samana päivänä otsikon merkitsevien sanojen perusteella
  (`isSameDeadline()`), ja osuma sidotaan aktiviteettiin. Numerot ja
  roomalaiset numerot erottavat tehtävät: jos molemmissa otsikoissa on
  niitä eikä yksikään ole yhteinen ("Azure - I" vs "Azure - II"), ne ovat
  eri tehtäviä.
- **Synkan raportti:** "Hae Moodlesta" kertoo, montako kurssia ja tehtävää
  tarkistettiin ja montako määräaikaa Moodlesta löytyi (joista jo listalla /
  uusia). Kurssikohtainen erittely näkyy tilatekstin päällä hiirellä, ja
  koko raportti (jokainen löydetty tehtävä ja mihin se täsmättiin)
  tallentuu tiedostoon `data/sync_report.json`. Jos yhtään kurssia ei voitu
  tarkistaa, tila näytetään virheenä eikä "ei uutta" -tuloksena.
- **Roskakurssit:** esim. "Library Moodle" näkyy profiilin kurssilistassa;
  piilota se kurssikortista.

## SAMK opinto-opas

`samk_catalog.js` täydentää kurssien puuttuvat kentät (`code`, `credits`,
`start`, `end`, `teacher`) SAMKin julkisesta opinto-oppaasta
(https://samk.opinto-opas.fi). Se ajetaan automaattisesti jokaisen
"Hae Moodlesta" -synkan yhteydessä, ja käsin `npm run catalog`.

- **Rajapinta:** opinto-oppaan oma taustarajapinta `/app/rest/`, ei
  kirjautumista. Dokumentoimaton, joten se voi muuttua; virhe kirjataan
  synkan virheisiin eikä kaada mitään.
  - `GET unit/degreeprogramme`: koulutusohjelmat (`id`, `code`, esim. `IC`)
  - `POST realization` (`{year, degreeProgrammeId, ...}`): ohjelman
    toteutukset lukuvuodelta, enintään 500 kerrallaan
  - `GET realization/<id>`: toteutuksen tiedot (`minCredits`/`maxCredits`,
    `startDate`, `endDate`, `teachers`, `groups`)
- **Koulutusohjelma** päätellään `SAMK_GROUP`:sta (`AIC25SP` -> `IC`) ja
  kurssikoodien etuliitteistä (`IC250105-3002` -> `IC`). Haetaan kuluva ja
  edellinen lukuvuosi (lukuvuosi vaihtuu elokuussa).
- **Kurssin tunnistus:** ensin koodilla (toteutus- tai opintojaksokoodi),
  sitten nimellä. Useista toteutuksista valitaan oman ryhmän toteutus
  (`SAMK_GROUP` tai yleisin ryhmä kursseilla, joilla on jo koodi) ja sitten
  se, joka on käynnissä kurssin alkaessa tai tänään. Jos valinta ei silti
  ole yksiselitteinen, täytetään vain kaikissa vaihtoehdoissa samat arvot.
- **Ei ylikirjoitusta:** vain puuttuvat kentät täytetään. `needsInfo`
  poistetaan, kun opintopisteet ja päivämäärät ovat tiedossa.

## Google-synkka

- `task` menee Google Tasksiin, muut tyypit Google-kalenteriin koko päivän
  tapahtumina.
- Jokainen deadline saa muistutustapahtuman edellisenä päivänä
  (`REMINDER_TIME_START`), EXAM-ikkunat varauksen avautumispäivänä.
- OAuth2-kirjautuminen omalla loopback-toteutuksella, `data/token.json`
  uusiutuu automaattisesti. Windowsilla selain avataan
  `rundll32 url.dll,FileProtocolHandler`:llä, koska `cmd /c start`
  katkaisee URL:n `&`-merkkiin.
- Idempotentti: `data/sync_state.json` muistaa, mikä deadline vastaa mitäkin
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
  `src/moodle/debug_fetch_page.js`:ää vianetsintään.
- Kaikki Moodle-osoitteet olettavat SAMKin Moodlen (`moodle5.samk.fi`).
- Opinto-oppaan rajapinta on dokumentoimaton ja voi muuttua ilman ilmoitusta.
