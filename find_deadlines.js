#!/usr/bin/env node
// find_deadlines.js
//
// Hakee jokaiselle kurssin tehtava/tentti-tyyppiselle Moodle-kohteelle
// (assign, quiz, workshop) sen oman Moodle-sivun ja poimii sielta talteen
// paasisallon tekstina seka rivit joissa nayttaa lukevan jotain paivamaaraan
// tai maaraaikaan viittaavaa. Tulos tallennetaan tiedostoon
// deadline_scan.json, jotta koko kurssien piilossa oleva tehtava/deadline-
// tieto voidaan kayda lapi kerralla sen sijaan etta jokainen Moodle-sivu
// pitaisi avata kasin.
//
// HUOM: tama EI muokkaa data.json:ia, se vain kirjoittaa erillisen
// tarkastelutiedoston. data.json:iin lisataan loydetyt deadlinet vasta
// kasin/keskustellen kun tulokset on kaytu lapi.
//
// Kaytto:
//   node find_deadlines.js                  # skannaa kaikkien kurssien assign/quiz-kohteet
//   node find_deadlines.js --course=<id>     # vain yksi kurssi (data.json:in id-kentta)
//   node find_deadlines.js --delay=500       # viive pyyntojen valissa ms (oletus 300)

const fs = require("fs");
const path = require("path");
require("./load_env.js").loadEnvFile();
const { fetchMoodlePage, htmlToText } = require("./scrape_course_content.js");
const { ensureFreshSession } = require("./refresh_moodle_session.js");

const DATA_JSON_PATH = path.join(__dirname, "data.json");
const OUTPUT_PATH = path.join(__dirname, "deadline_scan.json");
const SCANNABLE_TYPES = new Set(["assign", "quiz", "workshop"]);

// Suomeksi ja englanniksi yleisimmat maaraaika-sanat, seka paivamaarien
// tyypilliset muodot (esim. 14.10.2026, 14.10., "14. lokakuuta", "14 October
// 2026", "Due:", "Opens:", "Closes:" -- Moodle-instanssi renderoi otsikot
// englanniksi vaikka sisalto on suomeksi).
const DATE_HINT_RE =
  /(\d{1,2}\.\d{1,2}\.(\d{2,4})?|\d{1,2}\s+(tammi|helmi|maalis|huhti|touko|kes[aä]|hein[aä]|elo|syys|loka|marras|joulu)\w*|\d{1,2}\s+(january|february|march|april|may|june|july|august|september|october|november|december)\w*|m[aä][aä]r[aä]aika|er[aä]p[aä]iv[aä]|sulkeutu|avautu|k[aä]ytett[aä]viss[aä]|palautuksen|palautusp[aä]iv[aä]|deadline|due\s*:|due date|opened\s*:|opens?\s*:|closes?\s*:|cut-?off)/i;

// Depth-tasapainotettu div-poiminta annetulla avaus-tagin regexilla (esim.
// tietty id, data-region tai class), sama periaate kuin
// scrape_course_content.js:n findDivContent mutta yleisempi hakuehto.
function extractByOpenTag(html, openTagRegex) {
  const m = openTagRegex.exec(html);
  if (!m) return null;
  const start = m.index + m[0].length;
  const tagRe = /<div\b[^>]*>|<\/div>/gi;
  tagRe.lastIndex = start;
  let depth = 1;
  let tm;
  let end = html.length;
  while ((tm = tagRe.exec(html))) {
    if (tm[0].toLowerCase() === "</div>") depth--;
    else depth++;
    if (depth === 0) {
      end = tm.index;
      break;
    }
  }
  return html.slice(start, end);
}

function extractActivityDates(html) {
  const raw = extractByOpenTag(html, /<div\b[^>]*data-region="activity-dates"[^>]*>/i);
  return raw ? htmlToText(raw) : "";
}

function extractIntroDescription(html) {
  const raw = extractByOpenTag(html, /<div\b[^>]*id="intro"[^>]*>/i);
  return raw ? htmlToText(raw) : "";
}

function extractQuizInfo(html) {
  const raw = extractByOpenTag(html, /<div\b[^>]*class="[^"]*\bquizinfo\b[^"]*"[^>]*>/i);
  return raw ? htmlToText(raw) : "";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(argv) {
  const out = { course: null, delay: 300 };
  argv.forEach((a) => {
    if (a.startsWith("--course=")) out.course = a.slice("--course=".length);
    else if (a.startsWith("--delay=")) out.delay = parseInt(a.slice("--delay=".length), 10) || 300;
  });
  return out;
}

function findDateHintLines(text) {
  return text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l && DATE_HINT_RE.test(l))
    .slice(0, 20);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const data = JSON.parse(fs.readFileSync(DATA_JSON_PATH, "utf8"));

  let session = process.env.MOODLE_SESSION || null;
  if (process.env.MOODLE_USERNAME && process.env.MOODLE_PASSWORD) {
    const result = await ensureFreshSession(session);
    if (result.session) session = result.session;
  }
  if (!session) {
    console.error(
      "MoodleSession puuttuu. Aseta MOODLE_SESSION tai MOODLE_USERNAME+MOODLE_PASSWORD .env-tiedostoon (ks. .env.example)."
    );
    process.exit(1);
  }

  const results = [];
  let scanned = 0;
  for (const course of data) {
    if (opts.course && course.id !== opts.course) continue;
    if (!course.topics) continue;
    for (const topic of course.topics) {
      for (const item of topic.items || []) {
        if (!SCANNABLE_TYPES.has(item.type) || !item.url) continue;
        scanned++;
        process.stdout.write(`[${course.id}] ${item.title} ... `);
        try {
          const html = await fetchMoodlePage(item.url, session);
          const dueDatesText = extractActivityDates(html);
          const descriptionText = extractIntroDescription(html);
          const quizInfoText = extractQuizInfo(html);
          const combined = [dueDatesText, descriptionText, quizInfoText].filter(Boolean).join("\n\n");
          const hints = findDateHintLines(combined);
          results.push({
            course: course.id,
            courseName: course.name,
            topic: topic.name,
            title: item.title,
            type: item.type,
            url: item.url,
            dueDatesText,
            descriptionText: descriptionText.slice(0, 3000),
            quizInfoText,
            dateHints: hints,
          });
          console.log(
            "OK" +
              (dueDatesText ? ` [PÄIVÄMÄÄRÄT: ${dueDatesText.replace(/\n+/g, " / ")}]` : "") +
              (!dueDatesText && hints.length ? ` (${hints.length} vihjetta tekstissä)` : "") +
              (!dueDatesText && !hints.length ? " (ei löytynyt määräaikaa)" : "")
          );
        } catch (err) {
          console.log("VIRHE: " + err.message);
          results.push({
            course: course.id,
            courseName: course.name,
            topic: topic.name,
            title: item.title,
            type: item.type,
            url: item.url,
            error: err.message,
          });
        }
        await sleep(opts.delay);
      }
    }
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(results, null, 2) + "\n");
  console.log(`\nValmis. ${scanned} kohdetta kaytiin lapi, tallennettu tiedostoon ${OUTPUT_PATH}.`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Odottamaton virhe:", err);
    process.exit(1);
  });
}

module.exports = {
  findDateHintLines,
  parseArgs,
  SCANNABLE_TYPES,
  DATE_HINT_RE,
  extractByOpenTag,
  extractActivityDates,
  extractIntroDescription,
  extractQuizInfo,
};
