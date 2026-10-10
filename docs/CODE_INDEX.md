# Koodihakemisto

Tiedosto- ja funktiotason hakemisto koko projektista. Tarkoitettu
nopeaan navigointiin (ihmisille ja AI-agenteille): mistä mikäkin löytyy ja
mitä mikin funktio tekee. Arkkitehtuuri, tietomalli ja laskentalogiikan
perustelut ovat [INDEX.md](INDEX.md):ssä, muokkaussäännöt
[AGENTS.md](../AGENTS.md):ssä.

Rivinumerot ovat versiosta 1.2.5 ja siirtyvät koodin muuttuessa. Etsi
funktio nimellä (`function nimi(`), älä luota rivinumeroon sokeasti.

## Sisältö

1. [Hakemistorakenne](#hakemistorakenne)
2. [Juuren tiedostot](#juuren-tiedostot)
3. [public/index.html](#publicindexhtml)
4. [src/ (palvelin ja apumoduulit)](#src-palvelin-ja-apumoduulit)
5. [src/moodle/](#srcmoodle)
6. [src/integrations/](#srcintegrations)
7. [Kutsuketjut](#kutsuketjut)
8. [Mistä löytyy, kun haluan muuttaa...](#mistä-löytyy-kun-haluan-muuttaa)

## Hakemistorakenne

| Polku | Rivejä | Sisältö |
| --- | ---: | --- |
| `public/index.html` | 5241 | Koko käyttöliittymä: HTML, CSS ja JS (yksi IIFE) |
| `src/server.js` | 596 | HTTP-palvelin, API-reitit, uudelleenkäynnistys |
| `src/updater.js` | 209 | Päivitysten tarkistus ja asennus GitHubista |
| `src/json_file.js` | 76 | Atomiset kirjoitukset ja `data.json`:n muokkausajan vahti |
| `src/paths.js` | 70 | Kaikki tiedostopolut, vanhan rakenteen siirto |
| `src/load_env.js` | 61 | `.env`-jäsennin |
| `src/build.js` | 34 | `data.json` → `public/data.js` |
| `src/setup.js` | 82 | Käyttöönotto |
| `src/windows/shortcuts.ps1` | 28 | Työpöydän pikakuvakkeet |
| `src/moodle/sync_moodle.js` | 596 | "Hae Moodlesta" -synkka |
| `src/moodle/scrape_course_content.js` | 525 | Kurssisivujen haku ja jäsennys (`topics`) |
| `src/moodle/refresh_moodle_session.js` | 425 | Automaattinen SAMK-kirjautuminen |
| `src/moodle/update_from_moodle.js` | 368 | Deadlinet Moodlen kalenterin ICS-viennistä |
| `src/moodle/find_moodle_ids.js` | 241 | Kurssien `moodleId`:t profiilisivulta |
| `src/moodle/exam_windows.js` | 213 | Tentit kurssin tekstistä |
| `src/moodle/find_deadlines.js` | 184 | Tehtäväsivujen skannaus tarkistettavaksi |
| `src/moodle/moodle_dates.js` | 111 | Kaksikielinen päivämääräjäsennin |
| `src/moodle/debug_fetch_page.js` | 47 | Yhden Moodle-sivun tallennus `debug/`-kansioon |
| `src/integrations/sync_to_google.js` | 572 | Google Tasks- ja Calendar-vienti |
| `src/integrations/samk_catalog.js` | 315 | SAMKin opinto-opas |
| `src/integrations/estimate_deepseek.js` | 129 | DeepSeek-tuntiarviot |

## Juuren tiedostot

| Tiedosto | Sisältö |
| --- | --- |
| `package.json` | Nimi, `version` (päivitysilmoitus vertaa tätä GitHubiin), npm-skriptit (`setup`, `start`, `build`, `sync:moodle`, `sync:google`, `find-ids`, `catalog`). Ei riippuvuuksia. |
| `README.md` | Käyttöohje luokkalaisille (suomeksi, lyhyt) |
| `AGENTS.md` | Säännöt koodin muokkaamiseen, myös AI-agenteille |
| `CLAUDE.md` | Claude Coden aloituspiste: tuo AGENTS.md:n ja ohjaa dokumentteihin |
| `.env.example` | Asetuspohja (`MOODLE_*`, `SAMK_GROUP`, `GOOGLE_*`, `DEEPSEEK_API_KEY` ...) |
| `.gitignore` | Pitää omat tiedot (`.env`, `data/*`, `public/data.js`, `debug/`, `CLAUDE.local.md`) poissa gitistä |
| `.gitattributes` | `.bat`/`.ps1` CRLF:nä, muut LF:nä |
| `setup.bat`, `setup.sh` | Käyttöönotto Windowsissa / macOS:ssä ja Linuxissa. `setup.bat` tarjoaa Node.js:n asennusta ja pikakuvakkeita. |
| `kaynnista.bat` | Käynnistää palvelimen ja avaa selaimen |
| `paivita.bat` | Käsin päivitys: `git pull` tai zip + `robocopy`. Ajaa itsensä kopiona `%TEMP%`:stä. |
| `data/data.example.json` | Esimerkkikurssit, joista setup luo `data/data.json`:in |
| `docs/INDEX.md` | Tekninen hakemisto: arkkitehtuuri, tietomalli, API, laskenta, Moodle |
| `docs/CODE_INDEX.md` | Tämä tiedosto |
| `docs/google-kalenteri.md` | Google Cloud -asetusohje |
| `docs/images/` | README:n kuvakaappaukset |
| `public/icons/` | `dashboard.ico` (myös favicon), `paivita.ico` |

## public/index.html

Yksi tiedosto. Rakenne:

| Rivit | Osa |
| --- | --- |
| 1-1160 | `<style>`: design tokenit (`:root`, tumma teema), komponenttien CSS |
| 1162-1190 | `<header class="topbar">`: brändi, navigaatio, Hae Moodlesta / Vie Googleen, tilarivi (`#syncStatus`, `#updateNotice`) |
| 1191 | `#dashboardView`: yhteenvetokortit, suodattimet, deadline-listat, kurssikortit |
| 1240 | `#calendarView`: kuukausikalenteri ja päivän tiedot |
| 1259 | `#weekView`: jako/sekoitus, opiskeluaika, varoitukset, lukituspalkki, viikkoruudukko |
| 1299 | `#settingsView`: `.env`-asetukset |
| 1319 | `#profileView`: kurssin oma sivu (`#kurssi/<id>`) |
| 1351 | `#chipEditOverlay`: viikkolaatikon muokkausikkuna |
| 1384 | `#taskFormOverlay`: tehtävän luonti/muokkaus |
| 1429 | `<footer>`: `#appVersion` |
| 1435 | `<script src="data.js">` (määrittää `COURSES`) |
| 1436-5239 | Sovelluksen JS (yksi IIFE) |

### CSS-osiot (`<style>`)

Design tokens (9), Perusta (92), Yläpalkki (148), Otsikot ja ohjelaatikot
(249), Yhteenvetokortit (309), Suodatinsirut (340), Kokoontaitettavat
listaosiot (358), Deadline-taulukko (381), Lomakemodaali (572), Kurssikortit
(626), Kurssin profiilisivu (693), Kalenterin ja viikon otsikkorivi (794),
Kuukausikalenteri (807), Viikkonäkymä (946, sis. laatikot, raahaus,
✓-pallo, ajastin, muokkausikkuna), Asetukset (1048), Alatunniste (1115),
Kapeat näytöt (1124).

### JS: vakiot ja apurit

| Rivi | Funktio / vakio | Tehtävä |
| ---: | --- | --- |
| 1438 | `ICON_PATHS`, `icon(name)` | Inline-SVG-ikonit (`pencil`, `x`, `book`, `clock` ...) |
| 1452 | `TYPE_LABELS`, `TYPE_LABELS_PLURAL` | Tyyppien nimet: task, exam, examsys, lab, event |
| 1738 | `parseDate(iso)` | `YYYY-MM-DD` → paikallinen `Date` |
| 1743 | `startOfToday()` | Tämän päivän keskiyö |
| 1748 | `daysBetween(a, b)` | Päiviä kahden päivän välillä |
| 1757 | `setProgressLabel(el, l, r)` | Edistymispalkin kaksiosainen nimiö |
| 1767 | `addDays(d, n)` | Kesäaikaturvallinen päivien lisäys (käytä aina tätä) |
| 1771 | `fmtDate(d)` | Pitkä suomalainen päivämäärä |
| 2122 | `toIsoDate(d)` | `Date` → `YYYY-MM-DD` |
| 2160 | `fmtShort(d)` | `5.10.` |
| 1648 | `fmtDuration(min)` | Minuutit → `1:30` |

### JS: localStorage-tallennus

Jokaisella on `loadX()` ja `saveX()`, ja tila pidetään muuttujassa. Avaimet
(`opintodashboard_*`) on lueteltu INDEX.md:ssä.

| Rivi | Muuttuja | Avain | Sisältö |
| ---: | --- | --- | --- |
| 1476 | `statusMap` | `status_v1` | Tehtävän tila (`kesken`/`tehty`/`ei-tehda`/`poistettu`) |
| 1497 | `planMap` | `plan_v1` | Käsin syötetty Arvio ja Tahti |
| 1510 | `progressMap` | `progress_v1` | Valmiusprosentti |
| 1525 | `capacityArr` | `capacity_v1` | Opiskeluaika ma-su |
| 1542 | `noStudySet` | `nostudy_v1` | "Ei opiskella" -päivät |
| 1560 | `weekPlanMap` | `weekplan_v1` | Päiväkohtaiset tilannekuvat `{iso: [{k, h, title, course, color, done?}]}` |
| 1577 | `weekLockMap` | `weeklock_v1` | Lukitut viikot `{maanantai: lukituspäivä}` |
| 1593 | `weekPrefs` | `weekprefs_v1` | `{mode, mix}` |
| 1611 | `timeLog` | `timelog_v1` | Käytetty aika `{avain: {min, start}}` |
| 1656 | `examMap` | `exam_v1` | Kurssin tenttivalinta ja varattu EXAM-päivä |
| 1669 | `customItems` | `custom_v1` | Omat tehtävät (pysyvä `id`) |
| 1684 | `editsMap` | `edits_v1` | Moodle-tehtävien käsin tehdyt muokkaukset |
| 1701 | `courseStateMap` | `course_state_v1` | Kurssin tila (`completed`/`hidden`), `getCourseState()`, `setCourseState()` |

Ajastin (1620-1648): `getSpentMinutes(key)`, `runningTimerKey()`,
`startTimer(key)` (pysäyttää edellisen), `stopTimer(key)`,
`setSpentMinutes(key, min)`.

### JS: tehtävämalli

| Rivi | Funktio | Tehtävä |
| ---: | --- | --- |
| 1723 | `itemKey(courseId, item)` | Tallennusavain: `custom|<id>` tai `kurssi|päivä|otsikko`. Älä muuta muotoa. |
| 1728 | `getStatus(item)` | Tila, oletus `avoin` |
| 1731 | `isVisible(item)` | Ei poistettu |
| 1734 | `isPending(item)` | Tila on `avoin` |
| 1790 | `rebuildAllItems()` | Rakentaa litteän `allItems`-listan: `COURSES` + muokkaukset + omat tehtävät, piilotetut kurssit pois |
| 1841 | `migrateMovedDeadlines()` | Siirtää localStorage-merkinnät (myös `timeLog` ja `weekPlanMap`-avaimet) `movedFrom`-päiviltä uudelle päivälle |
| 1973 | `getUserEdit(item)` | Käsin tehty muokkaus |
| 1977 | `effDate(item)` | Tehokas päivä (varattu EXAM-päivä huomioiden). Käytä aina tätä. |
| 1987 | `shortCourseName(name)` | Kurssin nimi ilman toteutuskoodeja |
| 1999 | `appendItemLabel(el, item, text)` | Kaksirivinen nimiö (kurssi pienellä + otsikko) |
| 2010 | `displayTitle/Notes/Type(item)` | Näyttöarvot muokkaukset huomioiden |
| 2031 | `getCourseMoodleUrl(courseId)` | Linkki kurssin Moodle-sivulle |
| 2052 | `getPlanHoursPace(item)` | `{hours, pace}`: käsin syötetty tai datan arvio. Käytä aina tätä. |
| 2060 | `getProgressPct(item)` | Valmiusprosentti (vain `kesken`) |
| 2069 | `getRemainingHours(item)` | Arvio × (1 − valmius %) |
| 2075 | `computeStartByDate(item)` | "Aloita viimeistään" -päivä |
| 2084 | `compareBySortKey`, `applyDeadlineSort` | Deadline-listan lajittelu |
| 2129 | `getItemsByDate()` | Tehtävät päivittäin (kalenteri) |

### JS: tentit

| Rivi | Funktio | Tehtävä |
| ---: | --- | --- |
| 1885 | `getExamWindowInfo(courseId)` | Kurssin EXAM-ikkuna `{start, end}` |
| 1890 | `getExamDefaultBookBy(courseId)` | Oletuksena ikkunan loppu |
| 1900 | `getEffectiveExamChoice(courseId)` | Käyttäjän valinta tai oletus |
| 1910 | `isExamSystemItem(item)` | Onko EXAM-järjestelmän tentti (ikkuna + valinta) |
| 1919 | `getExamAvailability(courseId, iso)` | Kuinka suuri osa ikkunasta on jo varattavissa (`EXAM_BOOKING_HORIZON_DAYS`) |
| 1956 | `getExamOverride(item)` | Varattu EXAM-päivä korvaa paperitentin päivän |

### JS: viikkosuunnitelma (`#viikko`)

| Rivi | Funktio | Tehtävä |
| ---: | --- | --- |
| 2153 | `getWeekMonday(offset)` | Selattavan viikon maanantai |
| 2177 | `redistributeWeeks(perDay, start, horizon, lockedDays)` | Jakaa kalenteriviikot uudelleen painotuksen ja sekoituksen mukaan |
| 2198 | `redistributeSegment(perDay, days)` | Yhden viikon tavoitekuormat (`front`/`even`/`weekend`), määräaikakorjaus ja palasijoitus (`edf`, `feasible`) |
| 2341 | `computeWeekAllocation()` | Pääalgoritmi: `{perDay, overflow, noEstimate}`. Ahne jako tahdilla, toinen kierros ilman tahtia ennen määräaikaa, sitten uudelleenjako. Lukitut päivät kapasiteetilla 0. |
| 2458 | `planSnapshot(entries)` | `perDay`-rivit → tilannekuvan muoto |
| 2468 | `weekMondayIso(d)` | Päivän viikon maanantai |
| 2472 | `isWeekLocked(mondayIso)` | |
| 2477 | `isDayLocked(iso)` | Lukitun viikon päivä tänään tai myöhemmin |
| 2480 | `getLockedPlan()` | `{lockedDays, preUsed}`: lukitut päivät ja niille varatut tunnit (ei tehtyjä osia) |
| 2499 | `lockWeek(mondayIso)` | Tallentaa viikon näkyvän suunnitelman |
| 2584 | `unlockWeek(mondayIso)` | Poistaa viikon tulevat tilannekuvat |
| 2518 | `isEditableDay(iso)` | Mennyt tai lukittu päivä |
| 2521 | `moveLockedEntry(from, idx, to)` | Raahaus tallennettujen päivien välillä, yhdistää saman tehtävän |
| 2536 | `setLockedEntryHours(iso, idx, h)` | Laatikon tunnit |
| 2544 | `splitLockedEntry(iso, idx)` | Jako kahtia |
| 2556 | `setEntryPartDone(iso, idx, done)` | Osan tehty-merkintä |
| 2567 | `recomputeProgressFromParts(key, item)` | Valmius % tehdyistä osista, Avoin → Työn alla |
| 2602 | `recordTodayPlan()` | Tallentaa tämän päivän (jos ei lukittu), karsii yli 180 pv vanhat |
| 3913 | `renderWeek()` | Piirtää viikkonäkymän: asetukset, varoitukset, lukituspalkki, päiväsarakkeet, laatikot, raahaus, ✓, ajastin |
| 4173 | `openChipEditor(ctx)` | Laatikon ikkuna |
| 4191 | `closeChipEditor()` | |
| 4196 | `updateChipEditorDynamic()` | Valmius-, ajastin- ja käytetyn ajan tekstit |
| 4219 | `initChipEditor()` | Ikkunan tapahtumat, Esc, sekuntiajastin |

### JS: dashboard ja kurssit

| Rivi | Funktio | Tehtävä |
| ---: | --- | --- |
| 2623 | `renderChips()` | Tyyppisuodattimet |
| 2648 | `urgencyClass`, `urgencyText` | Kiireellisyyden väri ja teksti |
| 2665 | `createDeadlineHeader()` | Listan otsikkorivi ja lajittelu |
| 2699 | `appendDeadlineRows(wrap, items)` | |
| 2704 | `renderDeadlineItem(item)` | Yksi deadline-rivi: tila, Arvio/Tahti, Valmiina %, jäljellä/käytetty, EXAM-tiedot, muokkaus |
| 2881 | `updateStartBy` | Rivin "Aloita viimeistään" -solu |
| 2900 | `savePlan` | Rivin Arvio/Tahti tallennus |
| 2951 | `renderRestoreItem(item)` | Poistettujen palautus |
| 2982 | `renderLists()` | Tulevat, Työn alla, Tehdyt, Ei tehdä, Menneet |
| 3034 | `renderSummary()` | Yhteenvetokortit |
| 3089 | `buildCourseCard(course)` | Kurssikortti |
| 3232 | `renderHiddenCourseRestoreItem` | Piilotettujen kurssien palautus |
| 3257 | `renderCourses()` | Kurssikorttien ruudukko |
| 3286 | `renderExamWidget(course)` | Kurssisivun Tentti-laatikko |
| 3405 | `renderProfile(courseId)` | Kurssisivu: tiedot, tehtävät, Moodle-sisältö (`topics`) |
| 3640 | `renderAll()` | Dashboard kokonaan |

### JS: kalenteri (`#kalenteri`)

| Rivi | Funktio | Tehtävä |
| ---: | --- | --- |
| 3651 | `getItemPlanRange(item)` | Työskentelyjakso (aloita viimeistään → deadline) |
| 3663 | `computeCalendarBars()` | Työskentely- ja EXAM-palkit |
| 3680 | `computeExamWindowBars()` | EXAM-ikkunan palkki (varattavissa / ei vielä) |
| 3712 | `computeWeekBarOverlaps(...)` | Palkkien kaistat viikkoriville |
| 3749 | `createCalendarBarEl(...)` | |
| 3796 | `renderCalendar()` | Kuukausiruudukko (rivikorkeudet `gridTemplateRows`) |
| 4281 | `getInProgressItemsForDate(iso)` | Mitä pitäisi tehdä sinä päivänä |
| 4296 | `renderInProgressSection(...)` | |
| 4354 | `renderDayDetail()` | Valitun päivän tiedot |

### JS: reititys, asetukset, lomakkeet, synkka, päivitys

| Rivi | Funktio | Tehtävä |
| ---: | --- | --- |
| 4382 | `setNavActive(name)` | |
| 4389 | `showDashboard/Calendar/Week/Profile/Settings()` | Näkymän vaihto |
| 4430- | `SETTINGS_GROUPS` | Asetukset-näkymän kentät (`.env`-avaimet) |
| 4490 | `updateSettingsFieldStatus(key)` | "Asetettu"-tila ja Tyhjennä |
| 4517 | `renderSettingsGroups()` | |
| 4611 | `loadSettingsStatus()` | `GET /api/settings/status` |
| 4644 | `route()` | Hash-reititys (`#`, `#kalenteri`, `#viikko`, `#asetukset`, `#kurssi/<id>`) |
| 4671 | `refresh()` | `today` uusiksi, `rebuildAllItems()`, `recordTodayPlan()`, `route()` |
| 4732 | `populateCourseSelect`, `populateTypeSelect` | Lomakkeen valikot |
| 4761 | `openTaskForm(opts)`, `closeTaskForm()` | Tehtävän luonti/muokkaus |
| 4916 | `formatSyncTimestamp(ts)` | |
| 4931 | `describeSync(summary)` | Synkan tulosteksti (kuuluu yhteen `sync_moodle.js`:n `summary`:n kanssa) |
| 4980 | `showSyncResult(result, prefix)` | Tilarivi |
| 5157 | `renderUpdateNotice(info)` | "Uusi versio X saatavilla" + Päivitä |
| 5179 | `setUpdateMessage(text, isError)` | |
| 5185 | `installUpdate(btn)` | `POST /api/update`, odottaa uutta versiota, lataa sivun |
| 5221 | `checkForUpdates()` | `GET /api/version?force=1` sivun latautuessa |
| 5228- | Käynnistys | `recordTodayPlan()`, `initChipEditor()`, `route()`, `setTimeout(checkForUpdates, 1500)` |

## src/ (palvelin ja apumoduulit)

### src/server.js

| Rivi | Funktio | Tehtävä |
| ---: | --- | --- |
| 26 | `parseArgs()` | `--port` (oletus 8080), `--no-open` |
| 48 | `openInBrowser(url)` | Ei `cmd /c start` (katkeaa `&`-merkkiin) |
| 61 | `safeJoin(urlPath)` | Polku `public/`-kansion sisällä tai null |
| 88 | `allowedHosts`, `isAllowedHost` | Host-otsakkeen tarkistus (DNS rebinding) |
| 98 | `isAllowedApiRequest(req, port)` | Origin / Sec-Fetch-Site -tarkistus API:lle |
| 117 | `sendJson(res, code, obj)` | |
| 131 | `handleSyncRequest` | `POST /api/sync-moodle`, lukko |
| 181 | `handleSyncGoogleRequest` | `POST /api/sync-google` |
| 250 | `handleSettingsStatusRequest` | `GET /api/settings/status`, vain totuusarvot |
| 272 | `writeEnvValues(set, clear)` | Rivikohtainen `.env`-kirjoitus |
| 303 | `readRequestBody(req)` | Kokoraja |
| 315 | `handleSettingsSaveRequest` | `POST /api/settings`, ei rivinvaihtoja arvoissa |
| 379 | `prepareFiles()` | Vanhan rakenteen siirto + `data.js` |
| 393 | `serveStatic(req, res)` | |
| 438 | `handleVersionRequest` | `GET /api/version` |
| 444 | `handleUpdateRequest` | `POST /api/update` (409, jos synkka tai päivitys käynnissä) |
| 463 | `restartServer()` | Sulkee portit, käynnistää uuden prosessin samaan ikkunaan (`--no-open`) |
| 496 | `handleRequest(req, res, port)` | `API_ROUTES`-taulukko, POST vaatii `application/json` |
| 524 | `main()` | Kuuntelee 127.0.0.1 ja ::1. Jos portissa on jo dashboard, avaa vain selaimen. |

### src/updater.js

`REPO = "DrTinkle/Opintodashboard"`. Vientifunktiot: `checkForUpdate`,
`runUpdate`, `compareVersions`, `readTar`, `isProtected`, `currentVersion`.

| Rivi | Funktio | Tehtävä |
| ---: | --- | --- |
| 38 | `currentVersion()` | `package.json`:n versio |
| 43 | `compareVersions(a, b)` | Semver-vertailu |
| 53 | `updateMethod()` | `git` (jos `.git` ja git) tai `archive` |
| 63 | `checkForUpdate({force})` | raw.githubusercontent.com `package.json`, välimuisti 5 min |
| 82 | `parsePax`, `readTar` | Tar-jäsennin (pax- ja GNU-pitkät nimet) |
| 134 | `isProtected(path)` | `data/`, `.env`, `debug/`, `public/data.js` |
| 142 | `writeFileAtomic` | |
| 158 | `updateFromArchive()` | codeload tar.gz, vain muuttuneet tiedostot |
| 188 | `updateWithGit()` | `git pull --ff-only`, selkeä virhe paikallisista muutoksista |
| 200 | `runUpdate()` | Päivitys + `setup.js` |

### Muut

| Tiedosto | Funktiot |
| --- | --- |
| `src/json_file.js` | `writeTextAtomic`, `writeJsonAtomic` (tmp + rename, uusintayritys Windowsissa), `mtimeOf`, `readData()` → `{data, mtimeMs}`, `writeData(data, mtimeMs)` (kieltäytyy, jos tiedostoa muutettiin välissä) |
| `src/paths.js` | Polkuvakiot (`ROOT`, `DATA_DIR`, `PUBLIC_DIR`, `DEBUG_DIR`, `ENV_PATH`, `DATA_JSON_PATH`, `DATA_JS_PATH`, `SYNC_REPORT_PATH`, `DEADLINE_SCAN_PATH` ...), `debugFile(name)`, `migrateLegacyFiles()` |
| `src/load_env.js` | `parseEnv(text)`, `readEnvFile(path)`, `loadEnvFile(path)` (ei ylikirjoita `process.env`:ssä jo olevia) |
| `src/build.js` | `buildDataJs(data)`, ajettavissa suoraan (`npm run build`) |
| `src/setup.js` | Node-tarkistus, `migrateLegacyFiles()`, `copyIfMissing` (data.json, .env), build |
| `src/windows/shortcuts.ps1` | Pikakuvakkeet (ASCII, CRLF, ä = `[char]0x00E4`) |

## src/moodle/

| Tiedosto | Funktiot ja tehtävä |
| --- | --- |
| `sync_moodle.js` | `runSync()` (459): koko synkka, palauttaa `summary`:n ja kirjoittaa `data/sync_report.json`:n (`SYNC_REPORT_PATH`). `discoverAndAddNewCourses` (194): profiilisivun kurssit, puuttuvat `moodleId`:t, jatkokurssit. `scanCourseForNewDeadlines` (273): `topics` + assign/quiz/workshop-määräajat (`parseDueDate`), moodleUrl-dedup, siirtyneen päivän päivitys + `movedFrom`. `addTextExams` (413): `findTextExams`-tulokset tenteiksi. Apurit: `isSameDeadline`, `significantWords`, `distinguishingTokens`, `normalizeActivityUrl`, `guessDeadlineType` (sis. "midterm"), `pickUnusedColor`, `slugify`, `fiDate`. |
| `scrape_course_content.js` | `fetchMoodlePage(url, session)` (375): haku käyttäjän omalla kielellä, `res.ok`-tarkistus. `looksLikeLoginPage` (rakenteellinen) ja `looksLikeLoginPageLoose`. `scrapeCourseTopics` (336): välilehtiformaatti (`extractSectionTabs`). Jäsennys: `splitSections`, `extractSectionName`, `findDivContent`, `htmlToText`, `extractSectionSummary`, `extractLabelItems`, `extractItems`, `parseCoursePage`, `extractPageMainContent`, `enrichTextContent`. |
| `moodle_dates.js` | `parseDueDate(text)` (103): due → close, ei open. `parseActivityDateLines`, `classifyLabel` (OPEN_RE, CLOSE_RE, DUE_RE suomeksi ja englanniksi), `parseDateText` (englannin ja suomen kuukaudet, US-muoto, dd.mm.yyyy), `normalize` (pehmeät tavuviivat). |
| `exam_windows.js` | `findTextExams(topics, course)` (165): EXAM-ikkunat ja muut ikkunat, paperi- ja luokkatenttien päivät. `findDates`, `inferYear`, `defaultAnchor`, `rangeFrom`, `collectTexts`, `titleFor`. |
| `refresh_moodle_session.js` | `ensureFreshSession()` (317): tarkistaa, ja tarvittaessa kirjautuu (Shibboleth). `fetchFreshSessionCookie` (187), `isSessionValid` (300), `upsertEnvValue` (336), evästeapurit, `extractForms`, `request`. |
| `update_from_moodle.js` | ICS-vienti: `getIcsText`, `parseIcs`, `icsDateToIso`, `matchCourse` (kurssikoodi + `wordStem`), `isSameDeadline`, `guessType`, `main`. |
| `find_moodle_ids.js` | `fetchOwnCourseLinks` (profiilisivu ilman id:tä), `extractCourseLinks`, `scoreMatch`, `main`. |
| `find_deadlines.js` | `main`: aktiviteettisivut → `data/deadline_scan.json`. `extractActivityDates`, `extractQuizInfo`, `findDateHintLines`. |
| `debug_fetch_page.js` | `main`: yksi sivu `debug/`-kansioon |

## src/integrations/

| Tiedosto | Funktiot ja tehtävä |
| --- | --- |
| `sync_to_google.js` | `main(overrideOpts)` (420), `syncEntry` (462, hash-pohjainen ajantasaisuus). OAuth: `loginWithBrowser`, `handleOAuthCallback`, `refreshAccessToken`, `getAccessToken`, `loadGoogleCredentials` (.env tai credentials.json). API: `apiRequest`, `listAll`, `findOrCreateTaskList`, `findOrCreateCalendar`, `upsertTask`, `upsertEvent`. Rungot: `buildTaskBody`, `buildEventBody`, `buildDayBeforeReminderBody`. `deadlineKey`, `isInPast`. |
| `samk_catalog.js` | `enrichFromCatalog(data)` (224): täydentää vain puuttuvat kentät. `resolveProgrammeIds`, `inferUserGroups`, `loadRealizations`, `findCandidates`, `narrowCandidates`, `creditsOf`, `teacherOf`, `academicYear`. |
| `estimate_deepseek.js` | `estimateWithDeepSeek(...)` (74), `buildPrompt`, `extractJsonObject`, `sanitizeNumber` (0,5 h:n tarkkuus). |

## Kutsuketjut

**Sivun lataus:** `data.js` (`COURSES`) → IIFE: storage-lataukset →
`migrateMovedDeadlines()` → `rebuildAllItems()` → `recordTodayPlan()` →
`initChipEditor()` → `route()` → `show*()` → `render*()`;
`checkForUpdates()` 1,5 s myöhemmin.

**Viikkonäkymä:** `showWeek()` → `renderWeek()` →
`computeWeekAllocation()` (→ `getLockedPlan()`, ahne jako, toinen kierros,
`redistributeWeeks()` → `redistributeSegment()`) → päiväsarakkeet:
mennyt tai lukittu päivä `weekPlanMap`:sta, muut `perDay`:sta.

**Hae Moodlesta:** nappi → `POST /api/sync-moodle` →
`handleSyncRequest` → `runSync()` → `ensureFreshSession()` →
`discoverAndAddNewCourses()` → per kurssi `scanCourseForNewDeadlines()`
(`scrapeCourseTopics`, `fetchMoodlePage`, `parseDueDate`, uusille
tehtäville `estimateWithDeepSeek()`) → `addTextExams()` →
`enrichFromCatalog()` → `writeData()` + `buildDataJs()` → `summary` →
`describeSync()`.

**Päivitys:** `checkForUpdates()` → `GET /api/version?force=1` →
`checkForUpdate()`. Päivitä → `POST /api/update` → `runUpdate()`
(`updateWithGit` tai `updateFromArchive`) → `setup.js` →
`restartServer()` → sivu kyselee `/api/version` ja lataa uudelleen.

## Mistä löytyy, kun haluan muuttaa...

| Muutos | Paikka |
| --- | --- |
| Viikkosuunnitelman jakoalgoritmia | `computeWeekAllocation`, `redistributeSegment` |
| Lukitusta, raahausta, laatikoiden muokkausta | `lockWeek`, `getLockedPlan`, `moveLockedEntry`, `setLockedEntryHours`, `splitLockedEntry`, `setEntryPartDone`, `renderWeek` |
| Ajastinta | `timeLog`-apurit (1607-1650), `initChipEditor` |
| Deadline-rivin kenttiä | `renderDeadlineItem` |
| Moodlen päivämäärien tunnistusta | `moodle_dates.js` |
| Tenttien tunnistusta tekstistä | `exam_windows.js` |
| Synkan tulostekstiä | `sync_moodle.js` (`summary`) + `describeSync` |
| Uutta asetusta | `.env.example`, `server.js` `SETTINGS_KEYS`, `index.html` `SETTINGS_GROUPS` |
| Uutta API-reittiä | `server.js` `API_ROUTES` |
| Päivitystä | `updater.js`, `renderUpdateNotice`, `installUpdate` |
| Värejä ja teemaa | `:root`-muuttujat `<style>`:n alussa |
