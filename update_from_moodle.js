#!/usr/bin/env node
// update_from_moodle.js
//
// Hakee Moodlen kalenterin ICS-viennistä tulevat/kaikki tapahtumat ja
// täydentää niillä data.json:ia (uusina deadlineina niille kursseille
// joiden nimi tunnistetaan tapahtuman otsikosta). Ajaa lopuksi build.js:n
// logiikan ja päivittää myös data.js:n.
//
// Käyttö:
//   node update_from_moodle.js --url "https://moodle5.samk.fi/calendar/export_execute.php?...&authtoken=..."
//   node update_from_moodle.js --file kalenteri.ics
//   node update_from_moodle.js --url "..." --dry-run     (näyttää mitä tehtäisiin, ei kirjoita mitään)
//
// Miten saat ICS-linkin Moodlesta:
//   1. Kirjaudu Moodleen (moodle5.samk.fi) ja avaa Kalenteri
//   2. Valikosta rataskuvake / "Kalenterin asetukset" -> "Export calendar"
//      ("Vie kalenteri")
//   3. Valitse mitkä tapahtumat ("Kaikki tapahtumat" tai "Tapahtumat, joihin
//      osallistun") ja mikä aikaväli ("Kaikki tapahtumat" on turvallisin valinta)
//   4. Valitse "Julkaise kalenteritiedosto Internetissä" / "Get calendar URL"
//   5. Kopioi näkyviin tuleva linkki (se sisältää salaisen authtoken-parametrin,
//      älä jaa sitä kenellekään eikä committaa sitä mihinkään) ja anna se
//      tälle skriptille --url-lipulla, tai lataa sama linkki selaimella
//      tiedostoksi ja käytä --file-lippua
//
// Skripti ei tallenna linkkiä minnekään - anna se joka ajokerralla uudelleen,
// tai kopioi se itsellesi esim. muuttujaan omassa ajoskriptissäsi.

const fs = require("fs");
const path = require("path");
require("./load_env.js").loadEnvFile();
const { estimateWithDeepSeek } = require("./estimate_deepseek.js");

const DATA_JSON = path.join(__dirname, "data.json");
const DATA_JS = path.join(__dirname, "data.js");

// Avainsanat joilla Moodle-tapahtuman otsikosta (SUMMARY) tunnistetaan kurssi.
// Lisää tähän rivi jos uusi kurssi ei löydy Moodlen tapahtumista automaattisesti.
const COURSE_KEYWORDS = {
  pilviteknologiat: ["pilviteknologia"],
  fyslab: ["fysiikan laboraatio", "fyslab"],
  tito: ["tietoturvallinen ohjelmistotuotanto"],
  htmlcss: ["tiedon esittäminen", "html ja css"],
  relaatiotietokanta: ["relaatiotietokanta"],
  minaoy: ["minä oy", "toiminnallisen yrittäjyyden"],
  difis: ["differentiaali- ja integraalilaskenta", "differentiaalilaskenta"],
};

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--url") out.url = args[++i];
    else if (args[i] === "--file") out.file = args[++i];
    else if (args[i] === "--dry-run") out.dryRun = true;
    else if (args[i] === "--debug") out.debug = true;
  }
  return out;
}

async function getIcsText({ url, file }) {
  if (file) return fs.readFileSync(file, "utf8");
  if (url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error("ICS-haku epäonnistui: HTTP " + res.status);
    return await res.text();
  }
  throw new Error("Anna joko --url <linkki> tai --file <polku.ics>. Katso ohjeet tiedoston alusta.");
}

// Kevyt ICS-parseri - riittää Moodlen VEVENT-lohkoille, ei yritä tukea koko RFC 5545:tä.
function parseIcs(text) {
  const unfolded = text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "");
  const events = [];
  const blocks = unfolded.split("BEGIN:VEVENT").slice(1);
  for (const block of blocks) {
    const body = block.split("END:VEVENT")[0];
    const lines = body.split("\n").filter(Boolean);
    const ev = {};
    for (const line of lines) {
      const idx = line.indexOf(":");
      if (idx === -1) continue;
      const rawKey = line.slice(0, idx);
      const value = line.slice(idx + 1).trim();
      const key = rawKey.split(";")[0].trim().toUpperCase();
      if (key === "SUMMARY") ev.summary = decodeIcsText(value);
      else if (key === "DESCRIPTION") ev.description = decodeIcsText(value);
      else if (key === "DTSTART") ev.dtstart = value;
      else if (key === "URL") ev.url = value;
      else if (key === "UID") ev.uid = value;
      else if (key === "CATEGORIES") ev.categories = decodeIcsText(value);
    }
    if (ev.summary && ev.dtstart) events.push(ev);
  }
  return events;
}

function decodeIcsText(v) {
  return v.replace(/\\n/g, " ").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
}

function icsDateToIso(dtstart) {
  // "20261012" (koko päivä) tai "20261012T230000Z" (kellonaikaan sidottu)
  const m = dtstart.match(/^(\d{4})(\d{2})(\d{2})/);
  if (!m) return null;
  const [, y, mo, d] = m;
  return `${y}-${mo}-${d}`;
}

function matchCourse(ev, data) {
  const categories = (ev.categories || "").toLowerCase();
  if (categories) {
    // 1) Tarkin osuma: kurssikoodi (esim. "IC250105-3002") categories-kentässä.
    //    Tämä on se mitä SAMKin Moodle laittaa categories-kenttään, ei koko nimeä.
    for (const course of data) {
      if (course.code && categories.includes(course.code.toLowerCase())) return course.id;
    }
    // 2) Varalla: koko kurssin nimi categories-kentässä (jos Moodle joskus laittaakin sen).
    for (const course of data) {
      if (categories.includes(course.name.toLowerCase())) return course.id;
    }
  }
  // 3) Muuten yritä tunnistaa otsikosta avainsanalistalla.
  const lower = (ev.summary || "").toLowerCase();
  for (const [id, keywords] of Object.entries(COURSE_KEYWORDS)) {
    if (keywords.some((k) => lower.includes(k))) return id;
  }
  return null;
}

// Yleiset Moodle-fraasit joita ei kannata käyttää tunnistamaan onko kaksi
// tapahtumaa "sama asia" - muuten esim. kaikki "on palautettava viimeistään"
// -tapahtumat näyttäisivät samalta.
const GENERIC_WORDS = new Set([
  "on", "ja", "tai", "ei", "jos", "niin", "että", "joka", "jotka", "tästä",
  "tämä", "sen", "kuin", "yhtenä", "sekä", "sitä", "voi", "vielä", "kaikki",
  "pakollinen", "palautettava", "viimeistään", "avautuu", "sulkeutuu",
  "tehtävä", "asennus", "maininta", "näytönkaappaus", "ongelmasta",
  "liittyvät", "löydy", "toimivaa", "region", "määrittelyä", "pdf",
  "tiedostona", "tehtävän", "tehtävä", "palautus", "palatuksen",
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

// Sama päivä + vähintään yksi yhteinen "oikea" avainsana (esim. "essee", "azure",
// "linux") riittää tulkitsemaan kaksi eri tavalla kirjoitettua otsikkoa samaksi
// deadlineksi. Näin käsin kirjoitettu "GC - I Asennus - Linux vm" ja Moodlen
// raaka "Pakollinen -  GC - I Asennus - Linux vm on palautettava viimeistään"
// tunnistetaan samaksi eikä tule tuplaa.
function isSameDeadline(existingTitle, incomingTitle) {
  const existingWords = new Set(significantWords(existingTitle));
  const incomingWords = significantWords(incomingTitle);
  return incomingWords.some((w) => existingWords.has(w));
}

function guessType(summary, courseId) {
  const lower = summary.toLowerCase();
  if (lower.includes("tentti") || lower.includes("exam")) return "exam";
  if (courseId === "fyslab" || lower.includes("labra")) return "lab";
  if (
    lower.includes("määräpäivä") ||
    lower.includes("due") ||
    lower.includes("palautus") ||
    lower.includes("palautettava") ||
    lower.includes("viimeistään") ||
    lower.includes("closes") ||
    lower.includes("sulkeutuu") ||
    lower.includes("deadline")
  )
    return "task";
  return "event";
}

function writeDataJs(data) {
  const header =
    "// Opintodashboardin data.\n" +
    "// TÄMÄ TIEDOSTO ON GENEROITU data.json:sta - älä muokkaa suoraan.\n" +
    '// Muokkaa data.json:ia ja aja "node build.js" (tai update_from_moodle.js).\n\n';
  fs.writeFileSync(DATA_JS, header + "const COURSES = " + JSON.stringify(data, null, 2) + ";\n", "utf8");
}

async function main() {
  const args = parseArgs();
  const icsText = await getIcsText(args);
  const events = parseIcs(icsText);
  const data = JSON.parse(fs.readFileSync(DATA_JSON, "utf8"));

  if (args.debug) {
    console.log("--- KAIKKI TAPAHTUMAT (--debug) ---");
    for (const ev of events) {
      const date = icsDateToIso(ev.dtstart) || "?";
      console.log(`[${date}] ${ev.summary}`);
      if (ev.categories) console.log(`    categories: ${ev.categories}`);
      if (ev.url) console.log(`    url: ${ev.url}`);
      if (ev.description) console.log(`    desc: ${ev.description.slice(0, 120)}`);
    }
    console.log("--- LOPPU ---\n");
  }

  let added = 0;
  const unmatched = [];

  for (const ev of events) {
    const date = icsDateToIso(ev.dtstart);
    if (!date) continue;

    const courseId = matchCourse(ev, data);
    if (!courseId) {
      unmatched.push(ev);
      continue;
    }
    const course = data.find((c) => c.id === courseId);
    if (!course) continue;

    const alreadyExists = course.deadlines.some(
      (d) => d.date === date && isSameDeadline(d.title, ev.summary)
    );
    if (alreadyExists) continue;

    const newDeadline = {
      title: ev.summary,
      date,
      type: guessType(ev.summary, courseId),
      notes: ev.description || "",
    };
    // DeepSeek-aika-arvio VAIN aidosti uudelle deadlinelle (sama periaate
    // kuin sync_moodle.js:ssa) - ei koskaan jo tunnetuille, eika koskaan
    // kaada itse synkkaa jos arvio epaonnistuu.
    const estimate = await estimateWithDeepSeek(course, newDeadline);
    if (estimate) {
      newDeadline.estimatedHours = estimate.estimatedHours;
      newDeadline.estimatedPace = estimate.estimatedPace;
    }
    course.deadlines.push(newDeadline);
    added++;
  }

  data.forEach((c) => c.deadlines.sort((a, b) => a.date.localeCompare(b.date)));

  console.log(`Moodlen kalenterista löytyi ${events.length} tapahtumaa.`);
  console.log(`Näistä ${added} on uusia deadlineja jotka lisättäisiin data.json:iin.`);
  if (unmatched.length) {
    console.log(`\n${unmatched.length} tapahtumaa ei tunnistettu millekään kurssille:`);
    unmatched.forEach((ev) => {
      console.log("  - " + ev.summary + (ev.categories ? "   [categories: " + ev.categories + "]" : "   [ei categories-kenttää]"));
    });
    console.log('\nAja uudelleen lipulla "--debug" nähdäksesi jokaisen tapahtuman kaikki kentät (categories/url/desc),');
    console.log("niin näet miten kurssi olisi pitänyt tunnistaa, ja voit lisätä sen COURSE_KEYWORDS-listaan.");
  }

  if (args.dryRun) {
    console.log("\n[DRY-RUN] Mitään ei kirjoitettu levylle.");
    return;
  }

  if (added > 0) {
    fs.writeFileSync(DATA_JSON, JSON.stringify(data, null, 2) + "\n", "utf8");
    writeDataJs(data);
    console.log("\ndata.json ja data.js päivitetty.");
  } else {
    console.log("\nEi uutta lisättävää, tiedostoja ei koskettu.");
  }
}

main().catch((err) => {
  console.error("Virhe:", err.message);
  process.exit(1);
});
