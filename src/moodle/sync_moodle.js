#!/usr/bin/env node
// sync_moodle.js
//
// Kayy lapi kaikki Moodle-kurssisi ja:
//   1) etsii kokonaan UUDET kurssit joita data.json:issa ei viela ole, ja
//      lisaa ne sinne minimitiedoilla (nimi + moodleId), merkittyna
//      "needsInfo": true kunnes taydennat opintopisteet/opettajan/
//      alkamis-paattymispaivat kasin (dashboard nayttaa niista huomautuksen).
//   2) paivittaa jokaisen kurssin sisaltorakenteen (topics, kuten
//      scrape_course_content.js) jotta uudet aktiviteetit loytyvat.
//   3) etsii jokaiselta tehtava/tentti-tyyppiselta (assign/quiz/workshop)
//      aktiviteetilta sen oman "Due:"-paivamaaran ja lisaa siita UUDEN
//      deadlinen data.json:iin jos sita ei jo ole (samalla epatarkalla
//      otsikkotasmayksella kuin update_from_moodle.js kayttaa). Aktiviteetit
//      joilta ei loydy selvaa "Due:"-riviä jatetaan ennalleen (niiden
//      maaraaika pitaa paatella tekstista kasin, ks. find_deadlines.js).
//
// Kirjoittaa suoraan data.json:iin (ja paivittaa data.js:n build.js:n
// logiikalla) - ei erillista tarkistusvaihetta, koska loydetyt kohteet voi
// jalkikateen muokata/poistaa dashboardin omalla muokkaustyokalulla.
//
// Kaytto:
//   node src/moodle/sync_moodle.js
//   node src/moodle/sync_moodle.js --delay 800       (viive pyyntojen valissa ms, oletus 500)
//   node src/moodle/sync_moodle.js --userid 12345    (valinnainen oma Moodle-userid; oletus .env:n MOODLE_USERID)
//
// Tata kutsutaan myos server.js:n "/api/sync-moodle"-reitilta (dashboardin
// "Hae uudet Moodlesta" -nappi), jolloin runSync()-funktiota kutsutaan
// suoraan ilman komentorivia.

const fs = require("fs");
const path = require("path");
require("../load_env.js").loadEnvFile();
const { DATA_JSON_PATH, SYNC_REPORT_PATH: REPORT_PATH } = require("../paths.js");
const { buildDataJs } = require("../build.js");

const {
  fetchMoodlePage,
  scrapeCourseTopics,
  decodeEntities,
  BASE_URL,
} = require("./scrape_course_content.js");
const { scoreMatch, fetchOwnCourseLinks } = require("./find_moodle_ids.js");
const {
  extractActivityDates,
  extractIntroDescription,
  SCANNABLE_TYPES,
} = require("./find_deadlines.js");
const { estimateWithDeepSeek } = require("../integrations/estimate_deepseek.js");
const { findTextExams } = require("./exam_windows.js");

// REPORT_PATH (data/sync_report.json): viimeisimmän synkan yksityiskohtainen
// raportti (mitä Moodlesta löytyi ja mihin se täsmättiin). Ei jaeta.
// Valinnainen oma Moodle-käyttäjä-id luetaan .env:n MOODLE_USERID-kentästä
// (Asetukset-välilehti) kutsuhetkellä, jotta Asetuksissa tehty muutos on heti
// voimassa. Yleensä tyhjä: silloin haetaan kirjautuneen käyttäjän oma profiili.
function defaultUserid() {
  const v = Number(process.env.MOODLE_USERID);
  return Number.isFinite(v) && v > 0 ? v : null;
}
const MATCH_THRESHOLD = 40; // sama kynnys kuin find_moodle_ids.js:ssa

// Varivaihtoehdot uusille kursseille - kierratetaan jarjestyksessa,
// valttaen jo kaytossa olevia vareja (data.json:in nykyiset kurssit
// kayttavat sinista/vihreaa/keltaista/punaista/violettia/pinkkia/syaania).
const COLOR_PALETTE = [
  "#14b8a6", "#f97316", "#6366f1", "#84cc16", "#d946ef",
  "#0ea5e9", "#eab308", "#f43f5e", "#22c55e", "#a855f7",
];

function pickUnusedColor(data) {
  const used = new Set(data.map((c) => (c.color || "").toLowerCase()));
  const free = COLOR_PALETTE.find((c) => !used.has(c.toLowerCase()));
  return free || COLOR_PALETTE[data.length % COLOR_PALETTE.length];
}

function slugify(name, existingIds) {
  let base = decodeEntities(name)
    .toLowerCase()
    .replace(/ä/g, "a")
    .replace(/ö/g, "o")
    .replace(/å/g, "a")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
  if (!base) base = "kurssi";
  let id = base;
  let n = 2;
  while (existingIds.has(id)) {
    id = base + "-" + n;
    n++;
  }
  return id;
}

const MONTHS_EN = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

// Moodlen "activity-dates"-lohko on muotoa esim.
// "Opened: Monday, 31 August 2026, 1:00 AM\n\nDue: Wednesday, 14 October
// 2026, 11:59 PM" (sivut haetaan aina englanniksi, ks. fetchMoodlePage).
// Palautustehtävillä (assign) määräaika on "Due:". Aikaikkunallisilla
// harjoituksilla ja tenteillä (quiz) sitä ei ole, vaan ikkuna sulkeutuu:
// "Closes:" tai jo mennyt "Closed:". "Due:" ensin, sitten sulkeutuminen.
// "Opened:"/"Opens:" ei ole määräaika.
function dateAfterLabel(text, label) {
  const re = new RegExp("\\b" + label + "\\s*:\\s*[A-Za-z]+,\\s*(\\d{1,2})\\s+([A-Za-z]+)\\s+(\\d{4})", "i");
  return text.match(re);
}

function parseDueDate(activityDatesText) {
  if (!activityDatesText) return null;
  const m = dateAfterLabel(activityDatesText, "Due") || dateAfterLabel(activityDatesText, "Close[sd]?");
  if (!m) return null;
  const day = Number(m[1]);
  const month = MONTHS_EN[m[2].toLowerCase()];
  const year = Number(m[3]);
  if (!month || !day || !year) return null;
  return year + "-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0");
}

// Sama periaate kuin update_from_moodle.js:n isSameDeadline/significantWords
// (kopioitu tanne pienena, itsenaisena versiona, jotta synkka ei riipu
// ICS-tuontiskriptista).
const GENERIC_WORDS = new Set([
  "on", "ja", "tai", "ei", "jos", "niin", "että", "joka", "jotka", "tästä",
  "tämä", "sen", "kuin", "yhtenä", "sekä", "sitä", "voi", "vielä", "kaikki",
  "pakollinen", "palautettava", "viimeistään", "avautuu", "sulkeutuu",
  "tehtävä", "asennus", "maininta", "näytönkaappaus", "ongelmasta",
  "liittyvät", "löydy", "toimivaa", "region", "määrittelyä", "pdf",
  "tiedostona", "tehtävän", "palautus", "palatuksen",
  "harjoitus", "harjoitukset", "harjoitustehtävä", "viikkotehtävä",
]);

function significantWords(title) {
  return title
    .toLowerCase()
    .replace(/[()"“”,.:;\-–]/g, " ")
    .split(/\s+/)
    // Lyhyet sanat (pituus <= 2) karsitaan roskana, MUTTA pelkka numero
    // pidetaan aina, vaikka olisi lyhyt - "Viikkotehtava 1" vs "Viikkotehtava
    // 2" -tyyppisissa otsikoissa numero on ainoa erottava tieto, ja
    // "viikkotehtava" on omassa GENERIC_WORDS-listassa. Ilman tata poikkeusta
    // significantWords("Viikkotehtava 1") palautti tyhjan listan, jolloin
    // isSameDeadline ei koskaan tunnistanut tehtavaa edes itsekseen ja sama
    // tehtava tuplaantui data.json:iin joka skannauskerralla.
    .filter((w) => (w.length > 2 || /^\d+$/.test(w)) && !GENERIC_WORDS.has(w));
}

// Numerot ja roomalaiset numerot ("3", "I", "II") erottavat muuten
// samannimiset tehtävät, esim. "Azure - I Asennus" ja "Azure - II Asennus".
// Jos molemmissa otsikoissa on tällaisia eikä yksikään ole yhteinen, kyse on
// eri tehtävistä, vaikka muita yhteisiä sanoja olisi.
const ROMAN_NUMERAL_RE = /^(i|ii|iii|iv|v|vi|vii|viii|ix|x|xi|xii)$/;
function distinguishingTokens(title) {
  return String(title || "")
    .toLowerCase()
    .replace(/[()"“”,.:;\-–]/g, " ")
    .split(/\s+/)
    .filter((w) => /^\d+$/.test(w) || ROMAN_NUMERAL_RE.test(w))
    .map((w) => (/^\d+$/.test(w) ? String(Number(w)) : w));
}

function isSameDeadline(existingTitle, incomingTitle) {
  const existingTokens = new Set(distinguishingTokens(existingTitle));
  const incomingTokens = distinguishingTokens(incomingTitle);
  if (existingTokens.size && incomingTokens.length && !incomingTokens.some((t) => existingTokens.has(t))) {
    return false;
  }
  const existingWords = new Set(significantWords(existingTitle));
  const incomingWords = significantWords(incomingTitle);
  return incomingWords.some((w) => existingWords.has(w));
}

// Moodle-aktiviteetin osoite ilman kieliparametria ja ankkuria, jotta sama
// tehtävä tunnistetaan aina samaksi.
function normalizeActivityUrl(url) {
  try {
    const u = new URL(url);
    u.searchParams.delete("lang");
    u.hash = "";
    return u.toString();
  } catch {
    return url || null;
  }
}

function guessDeadlineType(item, course) {
  const lower = item.title.toLowerCase();
  if (
    lower.includes("tentti") ||
    lower.includes("exam") ||
    lower.includes("koe") ||
    lower.includes("valitentti") ||
    lower.includes("loppukoe")
  ) {
    return "exam";
  }
  if (/laboraatio|labra/i.test(course.name || "") || lower.includes("labra")) return "lab";
  return "task";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Etsii Moodle-profiilisivulta kaikki kurssit, taydentaa puuttuvat
// moodleId:t olemassa oleville data.json-kursseille (sama logiikka kuin
// find_moodle_ids.js), ja lisaa AIDOSTI uudet (ei tasmaa mihinkaan
// olemassa olevaan kurssiin edes valttavasti) kurssit data.json:iin
// minimitiedoilla. Mutatoi `data`-taulukkoa suoraan.
async function discoverAndAddNewCourses(data, session, baseUrl, opts) {
  // Käyttäjä-id on valinnainen: ilman sitä haetaan kirjautuneen käyttäjän
  // oma profiili (ks. fetchOwnCourseLinks).
  const userid = opts.userid || defaultUserid();
  let discovered;
  try {
    ({ discovered } = await fetchOwnCourseLinks(baseUrl, session, userid));
  } catch (err) {
    return { newCourses: [], error: "Kurssilistan haku epäonnistui: " + err.message };
  }
  if (!discovered.size) {
    return { newCourses: [], error: "Moodlen profiilisivulta ei löytynyt yhtään kurssia." };
  }
  const usedIds = new Set(data.filter((c) => c.moodleId).map((c) => c.moodleId));
  const existingIds = new Set(data.map((c) => c.id));
  const newCourses = [];

  // 1) Taydenna puuttuvat moodleId:t olemassa oleville kursseille.
  data.forEach((course) => {
    if (course.moodleId) return;
    let best = { id: null, score: 0 };
    discovered.forEach((labels, id) => {
      if (usedIds.has(id)) return;
      labels.forEach((label) => {
        const score = scoreMatch(course, label);
        if (score > best.score) best = { id, score };
      });
    });
    if (best.score >= MATCH_THRESHOLD) {
      course.moodleId = best.id;
      usedIds.add(best.id);
    }
  });

  // 2) Loput loydetyt kurssit joita ei voi tasmayttaa mihinkaan olemassa
  //    olevaan (ei jo kaytossa, eika riittavan hyvaa nimitasmaytysta) ovat
  //    aidosti uusia.
  discovered.forEach((labels, id) => {
    if (usedIds.has(id)) return;
    let bestNameScore = 0;
    data.forEach((course) => {
      labels.forEach((label) => {
        const score = scoreMatch(course, label);
        if (score > bestNameScore) bestNameScore = score;
      });
    });
    if (bestNameScore >= MATCH_THRESHOLD) return;

    const label = Array.from(labels).sort((a, b) => b.length - a.length)[0];
    const newId = slugify(label, existingIds);
    existingIds.add(newId);
    const course = {
      id: newId,
      name: label,
      code: null,
      credits: null,
      teacher: null,
      color: pickUnusedColor(data),
      start: null,
      end: null,
      moodleId: id,
      links: [{ label: "Moodle", url: `${baseUrl}/course/view.php?id=${id}` }],
      deadlines: [],
      needsInfo: true,
    };
    data.push(course);
    usedIds.add(id);
    newCourses.push({ id: newId, name: label, moodleId: id });
  });

  return { newCourses };
}

// Paivittaa yhden kurssin topics-kentan (uudet aktiviteetit mukaan) ja
// etsii sen assign/quiz/workshop-aktiviteeteilta uudet deadlinet joilla on
// selva "Due:"-paivamaara. Mutatoi course-oliota suoraan ja tayttaa
// summary-oliota.
async function scanCourseForNewDeadlines(course, session, baseUrl, opts, summary) {
  // Kurssikohtainen tilasto, jotta "0 uutta" voidaan erottaa tilanteesta,
  // jossa mitään ei oikeasti tarkistettu.
  const stat = { id: course.id, name: course.name, activities: 0, withDue: 0, known: 0, added: 0, items: [] };
  summary.courses.push(stat);
  let baseHtml;
  try {
    baseHtml = await fetchMoodlePage(`${baseUrl}/course/view.php?id=${course.moodleId}`, session);
  } catch (err) {
    stat.error = err.message;
    summary.errors.push(`[${course.id}] kurssisivun haku epäonnistui: ${err.message}`);
    return;
  }

  let topics;
  try {
    topics = await scrapeCourseTopics(course, baseHtml, session, baseUrl, { debug: false, delay: opts.delay });
  } catch (err) {
    stat.error = err.message;
    summary.errors.push(`[${course.id}] sisällön jäsennys epäonnistui: ${err.message}`);
    return;
  }
  course.topics = topics;
  summary.coursesScanned++;

  course.deadlines = course.deadlines || [];

  for (const topic of topics) {
    for (const item of topic.items || []) {
      if (!SCANNABLE_TYPES.has(item.type) || !item.url) continue;
      summary.activitiesScanned++;
      stat.activities++;

      let html;
      try {
        html = await fetchMoodlePage(item.url, session);
      } catch (err) {
        summary.errors.push(`[${course.id}] "${item.title}": ${err.message}`);
        continue;
      }
      await sleep(opts.delay);

      const isoDate = parseDueDate(extractActivityDates(html));
      if (!isoDate) {
        // ei selvaa maaraaikaa, jatetaan kasin tarkistettavaksi
        stat.items.push({ title: item.title, date: null, status: "no-due" });
        continue;
      }
      stat.withDue++;
      summary.dueFound++;

      // Moodlesta lisätyt deadlinet muistavat aktiviteettinsa osoitteen
      // (moodleUrl). Sellainen täsmää vain omaan aktiviteettiinsa, joten
      // kaksi samannäköistä Moodle-tehtävää ei voi "löytää" toisiaan.
      // Käsin lisätyt (ei moodleUrl:ia) täsmätään otsikon perusteella, ja
      // osuma sidotaan aktiviteettiin seuraavia hakuja varten.
      const activityUrl = normalizeActivityUrl(item.url);
      const match = course.deadlines.find(
        (d) =>
          d.date === isoDate &&
          (d.moodleUrl ? d.moodleUrl === activityUrl : isSameDeadline(d.title, item.title))
      );
      if (match && !match.moodleUrl && activityUrl) {
        match.moodleUrl = activityUrl;
        summary.linked++;
      }
      if (match) {
        stat.known++;
        summary.alreadyKnown++;
        stat.items.push({ title: item.title, date: isoDate, status: "known", matchedTo: match.title });
        continue;
      }

      const introText = extractIntroDescription(html);
      const newDeadline = {
        title: item.title,
        date: isoDate,
        type: guessDeadlineType(item, course),
        notes: introText ? introText.slice(0, 500) : "",
        moodleUrl: activityUrl,
      };
      // DeepSeek-aika-arvio VAIN aidosti uudelle tehtavalle (ei koskaan jo
      // tunnetuille - alreadyExists-tarkistus yllakin sen varmistaa), jotta
      // API-kutsuja ei tuhlata joka skannauskerralla samoihin tehtaviin.
      // Epaonnistuminen (puuttuva avain, verkkovirhe, jarjeton vastaus) ei
      // koskaan kaada skannausta - tehtava lisataan silti ilman arviota.
      const estimate = await estimateWithDeepSeek(course, newDeadline);
      if (estimate) {
        newDeadline.estimatedHours = estimate.estimatedHours;
        newDeadline.estimatedPace = estimate.estimatedPace;
      }
      course.deadlines.push(newDeadline);
      stat.added++;
      stat.items.push({ title: item.title, date: isoDate, status: "new" });
      summary.newTasks.push({
        course: course.id,
        courseName: course.name,
        title: item.title,
        date: isoDate,
      });
    }
  }

  await addTextExams(course, topics, summary, stat);
}

function fiDate(isoDate) {
  const [y, m, d] = isoDate.split("-").map(Number);
  return d + "." + m + "." + y;
}

// Tentit, jotka on kerrottu vain kurssin tekstissä (EXAM-ikkunat, paperi- ja
// luokkatentit, ks. exam_windows.js). Jo listalla oleva tunnistetaan: sama
// EXAM-ikkuna, tai tentti (tai otsikossa tentti/koe) samana päivänä.
const EXAM_TITLE_RE = /tentti|koe|exam/i;

async function addTextExams(course, topics, summary, stat) {
  for (const x of findTextExams(topics, course)) {
    const isExamWindow = x.kind === "window" && x.system === "exam";
    const date = x.kind === "window" ? x.end : x.date;
    const title = isExamWindow ? "Tentti (EXAM-ikkuna)" : x.kind === "date" ? x.title : "Tentti";
    stat.withDue++;
    summary.dueFound++;
    const match = course.deadlines.find(
      (d) =>
        (x.kind === "window" && d.examWindowStart === x.start && d.examWindowEnd === x.end) ||
        (d.date === date && (d.type === "exam" || EXAM_TITLE_RE.test(d.title || "")))
    );
    if (match) {
      stat.known++;
      summary.alreadyKnown++;
      stat.items.push({ title, date, status: "known", matchedTo: match.title, source: "text" });
      continue;
    }
    const context = x.context.length > 300 ? x.context.slice(0, 300) + "..." : x.context;
    let notes;
    if (isExamWindow) {
      notes =
        "EXAM-varausikkuna " + fiDate(x.start) + " - " + fiDate(x.end) + " (kurssin Moodle-sivulta)." +
        (x.link ? " Ilmoittautuminen: " + x.link : "");
    } else if (x.kind === "window") {
      notes = "Tentti-ikkuna " + fiDate(x.start) + " - " + fiDate(x.end) + ". Kurssin Moodle-sivulta: " + context;
    } else {
      notes = "Kurssin Moodle-sivulta: " + context;
    }
    const newDeadline = { title, date, type: "exam", notes };
    if (isExamWindow) {
      newDeadline.examWindowStart = x.start;
      newDeadline.examWindowEnd = x.end;
    }
    const estimate = await estimateWithDeepSeek(course, newDeadline);
    if (estimate) {
      newDeadline.estimatedHours = estimate.estimatedHours;
      newDeadline.estimatedPace = estimate.estimatedPace;
    }
    course.deadlines.push(newDeadline);
    stat.added++;
    stat.items.push({ title, date, status: "new", source: "text" });
    summary.newTasks.push({ course: course.id, courseName: course.name, title, date });
  }
}

async function runSync(opts = {}) {
  opts = { delay: 500, userid: defaultUserid(), baseUrl: BASE_URL, ...opts };
  const summary = {
    newCourses: [],
    newTasks: [],
    coursesScanned: 0,
    activitiesScanned: 0,
    dueFound: 0,
    alreadyKnown: 0,
    linked: 0,
    courses: [],
    errors: [],
    changed: false,
  };

  let session = process.env.MOODLE_SESSION || null;
  if (process.env.MOODLE_USERNAME && process.env.MOODLE_PASSWORD) {
    const { ensureFreshSession } = require("./refresh_moodle_session.js");
    const result = await ensureFreshSession(session);
    if (result.session) session = result.session;
  }
  if (!session) {
    throw new Error(
      "MoodleSession puuttuu. Aseta MOODLE_SESSION tai MOODLE_USERNAME+MOODLE_PASSWORD .env-tiedostoon (ks. .env.example)."
    );
  }

  const data = JSON.parse(fs.readFileSync(DATA_JSON_PATH, "utf8"));

  const courseResult = await discoverAndAddNewCourses(data, session, opts.baseUrl, opts);
  if (courseResult.error) summary.errors.push(courseResult.error);
  summary.newCourses = courseResult.newCourses || [];

  // Puuttuvat kurssitiedot (koodi, op, päivät, opettaja) SAMKin
  // opinto-oppaasta. Valinnainen: virhe ei kaada synkkaa.
  summary.catalogFilled = [];
  try {
    const { enrichFromCatalog } = require("../integrations/samk_catalog.js");
    summary.catalogFilled = await enrichFromCatalog(data, {
      log: (m) => summary.errors.push(m),
    });
  } catch (err) {
    summary.errors.push("Opinto-oppaan haku epäonnistui: " + err.message);
  }

  const scannable = data.filter((c) => c.moodleId);
  for (let i = 0; i < scannable.length; i++) {
    await scanCourseForNewDeadlines(scannable[i], session, opts.baseUrl, opts, summary);
    if (i < scannable.length - 1) await sleep(opts.delay);
  }

  data.forEach((c) => {
    if (c.deadlines) c.deadlines.sort((a, b) => a.date.localeCompare(b.date));
  });

  summary.changed =
    summary.newCourses.length > 0 ||
    summary.newTasks.length > 0 ||
    summary.catalogFilled.length > 0 ||
    summary.linked > 0;
  if (summary.changed) {
    fs.writeFileSync(DATA_JSON_PATH, JSON.stringify(data, null, 2) + "\n", "utf8");
    buildDataJs(data);
  }

  try {
    fs.writeFileSync(
      REPORT_PATH,
      JSON.stringify({ finishedAt: new Date().toISOString(), ...summary }, null, 2) + "\n",
      "utf8"
    );
  } catch (err) {
    // Raportti on vain apuväline, sen kirjoitus ei saa kaataa synkkaa.
  }

  return summary;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--delay") out.delay = Number(args[++i]);
    else if (args[i] === "--userid") out.userid = Number(args[++i]);
  }
  return out;
}

module.exports = { runSync, parseDueDate, slugify, pickUnusedColor, isSameDeadline, guessDeadlineType, normalizeActivityUrl };

if (require.main === module) {
  runSync(parseArgs())
    .then((summary) => {
      console.log("\nValmis.");
      console.log(`Uusia kursseja: ${summary.newCourses.length}`);
      summary.newCourses.forEach((c) =>
        console.log(`  + [${c.id}] ${c.name} (moodleId ${c.moodleId})`)
      );
      console.log(`Kurssitietoja täydennetty opinto-oppaasta: ${summary.catalogFilled.length}`);
      summary.catalogFilled.forEach((c) => console.log(`  * ${c.name}: ${c.fields.join(", ")}`));
      console.log(`Uusia tehtäviä: ${summary.newTasks.length}`);
      summary.newTasks.forEach((t) => console.log(`  + [${t.course}] ${t.title} (${t.date})`));
      console.log(`Kursseja skannattu: ${summary.coursesScanned}, aktiviteetteja tarkistettu: ${summary.activitiesScanned}`);
      console.log(`Määräaikoja Moodlessa: ${summary.dueFound}, joista jo listalla: ${summary.alreadyKnown}`);
      if (summary.activitiesScanned > 0 && summary.dueFound === 0) {
        console.log("VAROITUS: tehtäviä löytyi, mutta yhdeltäkään ei tunnistettu määräaikaa. Katso data/sync_report.json.");
      }
      summary.courses.forEach((c) =>
        console.log(
          `  ${c.name}: ${c.activities} tehtävää, ${c.withDue} määräaikaa, ${c.known} jo listalla, ${c.added} uutta` +
            (c.error ? ` (VIRHE: ${c.error})` : "")
        )
      );
      console.log("Yksityiskohdat: data/sync_report.json");
      if (summary.errors.length) {
        console.log(`\nVirheitä (${summary.errors.length}):`);
        summary.errors.forEach((e) => console.log("  ! " + e));
      }
      console.log(summary.changed ? "\ndata.json ja data.js päivitetty." : "\nEi muutoksia.");
    })
    .catch((err) => {
      console.error("Odottamaton virhe:", err);
      process.exit(1);
    });
}
