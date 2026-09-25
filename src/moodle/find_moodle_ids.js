#!/usr/bin/env node
// find_moodle_ids.js
//
// Hakee automaattisesti kaikkien Moodle-kurssiesi numeeriset id:t (samat
// jotka näkyvät osoitteessa course/view.php?id=<numero>) ja täyttää ne
// data.json:in "moodleId"-kenttiin, jotta niitä ei tarvitse käydä
// katsomassa käsin joka kurssilta.
//
// Hakee tähän oman profiilisivusi "kaikki kurssini" -näkymän
// (user/profile.php?id=<userid>&showallcourses=1), joka listaa kaikki
// kurssisi linkkeinä. Tunnistetaan sitten kurssi data.json:issa vertaamalla
// linkin tekstiä kurssin "name"-kenttään.
//
// Käyttö:
//   node src/moodle/find_moodle_ids.js --session "<MoodleSession-arvo>"
//   node src/moodle/find_moodle_ids.js --session "..." --userid <oma numero>
//   node src/moodle/find_moodle_ids.js --session "..." --dry-run
//
// Tarvitset oman Moodle-käyttäjä-id:si (numero, näkyy mm. kalenterin
// ICS-vientilinkin "userid="-parametrista tai omasta profiilisivustasi
// Moodlessa) joko --userid-lipulla tässä, tai MOODLE_USERID-kenttänä
// dashboardin Asetukset-sivulla / .env-tiedostossa - ei enää mitään
// oletusarvoa, koska tämä on jokaiselle oma.

const fs = require("fs");
const path = require("path");
const { decodeEntities, stripTags, fetchMoodlePage, BASE_URL } = require("./scrape_course_content.js");
require("../load_env.js").loadEnvFile();
const { DATA_JSON_PATH, debugFile } = require("../paths.js");
const { buildDataJs } = require("../build.js");

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {
    session: process.env.MOODLE_SESSION || null,
    userid: process.env.MOODLE_USERID ? Number(process.env.MOODLE_USERID) : null,
    dryRun: false,
    debug: false,
    baseUrl: BASE_URL,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--session") out.session = args[++i];
    else if (a === "--userid") out.userid = Number(args[++i]);
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--debug") out.debug = true;
    else if (a === "--base-url") out.baseUrl = args[++i];
  }
  return out;
}

function normalize(s) {
  return decodeEntities(s)
    .toLowerCase()
    .replace(/[^a-z0-9äöå]+/g, " ")
    .trim();
}

// Poimii kaikki kurssilinkit sivulta, ja niiden "nimilapun": ensisijaisesti
// title-attribuutti (usein koko kurssin nimi), muuten linkin oma
// tekstisisältö. Profiilisivun "Course details" -> "Course profiles"
// -lista käyttää muotoa user/view.php?id=<oma id>&course=<kurssin id>,
// EI course/view.php?id=<id> (vaikka jälkimmäinen johtaa samaan kurssiin) -
// tuetaan molempia muotoja varmuuden vuoksi.
function extractCourseLinks(html) {
  const found = new Map(); // id -> Set<label>
  const patterns = [
    /<a\s+[^>]*href="([^"]*\/course\/view\.php\?[^"]*\bid=(\d+)[^"]*)"[^>]*>([\s\S]*?)<\/a>/g,
    /<a\s+[^>]*href="([^"]*\/user\/view\.php\?[^"]*\bcourse=(\d+)[^"]*)"[^>]*>([\s\S]*?)<\/a>/g,
  ];
  patterns.forEach((re) => {
    let m;
    while ((m = re.exec(html))) {
      const id = Number(m[2]);
      const fullOpenTag = m[0].slice(0, m[0].indexOf(">") + 1);
      const titleAttr = fullOpenTag.match(/\btitle="([^"]*)"/i);
      const inner = decodeEntities(stripTags(m[3])).trim();
      const label = (titleAttr ? decodeEntities(titleAttr[1]) : inner).trim();
      if (!label) continue;
      if (!found.has(id)) found.set(id, new Set());
      found.get(id).add(label);
    }
  });
  return found;
}

function scoreMatch(course, label) {
  const normLabel = normalize(label);
  const normName = normalize(course.name);
  if (!normLabel || !normName) return 0;
  if (normLabel === normName) return 100;
  if (course.code && normLabel.includes(normalize(course.code))) return 95;
  if (normLabel.includes(normName) || normName.includes(normLabel)) return 85;

  const labelWords = new Set(normLabel.split(" ").filter((w) => w.length > 2));
  const nameWords = normName.split(" ").filter((w) => w.length > 2);
  const overlap = nameWords.filter((w) => labelWords.has(w)).length;
  if (nameWords.length > 0 && overlap === nameWords.length) return 80;
  if (overlap >= 2) return 40 + overlap * 5;
  if (overlap === 1) return 20;
  return 0;
}

const MATCH_THRESHOLD = 40;

async function main() {
  const opts = parseArgs();

  if (process.env.MOODLE_USERNAME && process.env.MOODLE_PASSWORD) {
    const { ensureFreshSession } = require("./refresh_moodle_session.js");
    const { session } = await ensureFreshSession(opts.session);
    if (session) opts.session = session;
  }

  if (!opts.session) {
    console.error(
      'Anna --session "<MoodleSession-evästeen arvo>", tai laita MOODLE_SESSION (tai ' +
        "MOODLE_USERNAME+MOODLE_PASSWORD kirjautumista varten kokonaan automaattiseksi) " +
        ".env-tiedostoon (ks. .env.example). Katso ohjeet README.md:stä."
    );
    process.exit(1);
  }

  if (!opts.userid || Number.isNaN(opts.userid)) {
    console.error(
      "Anna oma Moodle-käyttäjä-id:si --userid-lipulla, tai aseta se dashboardin " +
        "Asetukset-sivulla (tai suoraan MOODLE_USERID-kenttänä .env-tiedostoon). " +
        "Löydät sen kalenterin ICS-vientilinkin \"userid=\"-parametrista tai omalta " +
        "profiilisivultasi Moodlessa."
    );
    process.exit(1);
  }

  const url = `${opts.baseUrl}/user/profile.php?id=${opts.userid}&showallcourses=1`;
  console.log(`Haetaan kurssilista: ${url}`);
  let html;
  try {
    html = await fetchMoodlePage(url, opts.session);
  } catch (err) {
    console.error("VIRHE: " + err.message);
    process.exit(1);
  }

  const discovered = extractCourseLinks(html);

  if (opts.debug || discovered.size === 0) {
    fs.writeFileSync(debugFile("debug_profile.html"), html);
    console.log(`(debug: koko sivu tallennettu -> debug/debug_profile.html, ${html.length} merkkiä)`);
  }

  if (discovered.size === 0) {
    console.log(
      "Sivulta ei löytynyt yhtään course/view.php-linkkiä. Joko --userid on väärä, sivu on eri " +
        "muotoinen kuin odotettiin, tai istunto ei toiminut."
    );
    return;
  }
  console.log(`Löytyi ${discovered.size} kurssilinkkiä sivulta.\n`);

  const data = JSON.parse(fs.readFileSync(DATA_JSON_PATH, "utf8"));
  const usedIds = new Set(data.filter((c) => c.moodleId).map((c) => c.moodleId));
  let anyChanged = false;
  const matchedReport = [];
  const unmatchedCourses = [];

  data.forEach((course) => {
    if (course.moodleId) {
      matchedReport.push(`  [${course.id}] moodleId ${course.moodleId} on jo asetettu, ei koskettu.`);
      return;
    }
    let best = { id: null, label: null, score: 0 };
    discovered.forEach((labels, id) => {
      if (usedIds.has(id)) return; // jo toiselle kurssille varattu id, ei kelpaa uudelleen
      labels.forEach((label) => {
        const score = scoreMatch(course, label);
        if (score > best.score) best = { id, label, score };
      });
    });

    if (best.score >= MATCH_THRESHOLD) {
      matchedReport.push(
        `  [${course.id}] "${course.name}" -> moodleId ${best.id} (täsmäys "${best.label}", pisteet ${best.score})`
      );
      if (!opts.dryRun) {
        course.moodleId = best.id;
        usedIds.add(best.id);
        anyChanged = true;
      }
    } else {
      unmatchedCourses.push(course);
    }
  });

  console.log("Täsmäytykset:");
  matchedReport.forEach((line) => console.log(line));

  if (unmatchedCourses.length) {
    console.log("\nEi löytynyt varmaa täsmäystä näille kursseille:");
    unmatchedCourses.forEach((c) => console.log(`  [${c.id}] "${c.name}"`));
    console.log("\nKaikki sivulta löytyneet kurssilinkit (voit katsoa löytyykö joukosta oikea id käsin):");
    discovered.forEach((labels, id) => {
      console.log(`  id=${id}: ${Array.from(labels).join(" / ")}`);
    });
  }

  if (opts.dryRun) {
    console.log("\n--dry-run: mitään ei kirjoitettu data.json:iin.");
    return;
  }

  if (anyChanged) {
    fs.writeFileSync(DATA_JSON_PATH, JSON.stringify(data, null, 2) + "\n");
    buildDataJs(data);
    console.log("\ndata.json ja data.js päivitetty.");
  } else {
    console.log("\nEi muutoksia data.json:iin.");
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Odottamaton virhe:", err);
    process.exit(1);
  });
}

module.exports = { extractCourseLinks, scoreMatch, normalize };
