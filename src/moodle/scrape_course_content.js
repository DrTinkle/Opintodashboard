#!/usr/bin/env node
// scrape_course_content.js
//
// Hakee Moodle-kurssisivun sisältörakenteen (aihealueet ja niiden
// materiaalit/linkit: tiedostot, kansiot, tehtävät, linkit, ym.) ja
// tallentaa ne data.json:in "topics"-kenttään per kurssi.
//
// Kurssin päänäkymä (course/view.php) vaatii kirjautumisen, toisin kuin
// kalenterin ICS-vienti jolla on oma authtoken. Tässä käytetään selaimen
// MoodleSession-evästettä tunnistautumiseen.
//
// Käyttö:
//   node src/moodle/scrape_course_content.js --session "<MoodleSession-arvo>"
//   node src/moodle/scrape_course_content.js --session "..." --course 1497
//   node src/moodle/scrape_course_content.js --session "..." --dry-run
//   node src/moodle/scrape_course_content.js --session "..." --debug
//
// MoodleSession-evästeen hakeminen:
//   1. Kirjaudu Moodleen selaimessa (moodle5.samk.fi)
//   2. Avaa DevTools (F12) -> Application-välilehti -> Cookies -> moodle5.samk.fi
//      (Chromessa "Application", Firefoxissa "Storage")
//   3. Etsi rivi nimeltä "MoodleSession", kopioi sen Value-sarake
//   4. Eväste vanhenee ajoittain (uloskirjautuminen, pitkä käyttämättömyys) -
//      jos skripti valittaa kirjautumissivusta, hae eväste uudelleen
//
// Kursseille pitää olla data.json:issa "moodleId"-kenttä (numero URL:in
// course/view.php?id=<numero> -osasta). Kurssit joilla ei ole moodleId:tä
// ohitetaan.

const fs = require("fs");
const path = require("path");
require("../load_env.js").loadEnvFile();
const { DATA_JSON_PATH, debugFile } = require("../paths.js");
const { buildDataJs } = require("../build.js");
const BASE_URL = "https://moodle5.samk.fi";

// Moodlen mod-tyyppien lyhyet suomenkieliset tunnisteet dashboardia varten.
const TYPE_LABELS = {
  resource: "tiedosto",
  folder: "kansio",
  url: "linkki",
  assign: "tehtävä",
  quiz: "tentti",
  forum: "keskustelu",
  page: "sivu",
  label: "teksti",
  book: "kirja",
  choice: "kysely",
  feedback: "palaute",
  lesson: "oppitunti",
  workshop: "työpaja",
  wiki: "wiki",
  glossary: "sanasto",
  scorm: "scorm",
  h5pactivity: "h5p",
  bigbluebuttonbn: "video",
  data: "tietokanta",
  survey: "kysely",
  chat: "chat",
};

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {
    session: process.env.MOODLE_SESSION || null,
    course: null,
    dryRun: false,
    debug: false,
    delay: 800,
    baseUrl: BASE_URL,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--session") out.session = args[++i];
    else if (a === "--course") out.course = Number(args[++i]);
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--debug") out.debug = true;
    else if (a === "--delay") out.delay = Number(args[++i]);
    else if (a === "--base-url") out.baseUrl = args[++i];
  }
  return out;
}

const NAMED_ENTITIES = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  auml: "ä", ouml: "ö", aring: "å", Auml: "Ä", Ouml: "Ö", Aring: "Å",
  eacute: "é", egrave: "è", uuml: "ü", szlig: "ß",
  ndash: "–", mdash: "—", hellip: "…",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
};

function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&([a-zA-Z]+);/g, (full, name) => (name in NAMED_ENTITIES ? NAMED_ENTITIES[name] : full));
}

function stripTags(s) {
  return s.replace(/<[^>]+>/g, "");
}

function looksLikeLoginPage(html) {
  return /id="page-login-index"/i.test(html) || /Kirjaudu sisään/i.test(html) || /Log in to the site/i.test(html);
}

function splitSections(html) {
  // Rajataan aihealueet niiden alkumerkin (<li id="section-N" ...>) kohdilta
  // seuraavan aihealueen alkuun asti - ei täydellinen HTML-parsinta, mutta
  // riittää koska emme tarvitse sulkevia tageja, vain väliin jäävän sisällön.
  const re = /<li\s[^>]*\bid="section-(\d+)"[^>]*>/g;
  const marks = [];
  let m;
  while ((m = re.exec(html))) marks.push({ index: m.index, num: m[1] });
  const sections = [];
  for (let i = 0; i < marks.length; i++) {
    const start = marks[i].index;
    const end = i + 1 < marks.length ? marks[i + 1].index : html.length;
    sections.push({ num: marks[i].num, html: html.slice(start, end) });
  }
  return sections;
}

function extractSectionName(chunk, num) {
  let m =
    chunk.match(/<h3[^>]*class="[^"]*sectionname[^"]*"[^>]*>([\s\S]*?)<\/h3>/i) ||
    chunk.match(/<div[^>]*class="[^"]*sectionname[^"]*"[^>]*>([\s\S]*?)<\/div>/i) ||
    chunk.match(/<span[^>]*class="[^"]*sectionname[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
  let name = m ? decodeEntities(stripTags(m[1])).trim() : "";
  if (!name) name = num === "0" ? "Yleiset" : "Aihe " + num;
  return name;
}

// Sisältötyypit joiden varsinainen teoriateksti haetaan mukaan (ei vain
// linkkinä) - kuvat, videot, tiedostot ja muut jätetään linkeiksi, koska
// niiden sisältöä ei voi/kannata purkaa tekstiksi samalla tavalla.
const TEXT_CONTENT_TYPES = new Set(["page", "label"]);

// Etsii ensimmäisen div:in jonka class-attribuutti sisältää classHintin,
// alkaen fromIndexistä, ja palauttaa sen SISÄLLÖN (sisäkkäiset divit
// laskettu oikein) sekä indeksin heti sulkevan </div>:n jälkeen.
function findDivContent(html, classHint, fromIndex) {
  const re = new RegExp(`<div\\b[^>]*class="[^"]*\\b${classHint}\\b[^"]*"[^>]*>`, "i");
  re.lastIndex = 0;
  const searchFrom = html.slice(fromIndex || 0);
  const m = re.exec(searchFrom);
  if (!m) return null;
  const start = (fromIndex || 0) + m.index + m[0].length;
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
  return { content: html.slice(start, end), endIndex: end };
}

// Muuttaa Moodlen tuottaman rikkaan HTML-sisällön (teoriatekstit, labelit,
// aiheiden kuvaukset) luettavaksi tavalliseksi tekstiksi: linkit säilyvät
// muodossa "teksti (osoite)", kuvat/skriptit poistetaan kokonaan (kuvat
// näkyvät dashboardissa vain omina linkkikohteinaan, ei upotettuna tekstiin).
function htmlToText(html) {
  let s = html.replace(/\r\n?/g, "\n");
  s = s.replace(/<(script|style|iframe|svg)[\s\S]*?<\/\1>/gi, "");
  s = s.replace(/<img[^>]*>/gi, "");
  s = s.replace(/<a\s+[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (full, href, text) => {
    const t = decodeEntities(stripTags(text)).trim();
    const url = decodeEntities(href);
    return t && t !== url ? `${t} (${url})` : url;
  });
  s = s.replace(/<tr[^>]*>/gi, "\n");
  s = s.replace(/<li[^>]*>/gi, "\n- ");
  s = s.replace(/<(td|th)[^>]*>/gi, "| ");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n");
  s = stripTags(s);
  s = decodeEntities(s);
  // siistitään rivi kerrallaan: ylimääräiset välilyönnit ja rivin reunoille jääneet
  // pelkät pystyviivat (tyhjistä taulukkosoluista) pois.
  s = s
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").replace(/^[ |]+|[ |]+$/g, "").trim())
    .join("\n");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

// Aiheen oma kuvausteksti (näkyy Moodlessa aiheotsikon alla, ennen
// materiaalilistaa) - usein tässä on juuri sitä "teoriaa" mitä opettaja on
// kirjoittanut suoraan aiheen kuvaukseen.
function extractSectionSummary(chunk) {
  const found = findDivContent(chunk, "summarytext", 0);
  if (!found) return "";
  return htmlToText(found.content);
}

// Label-aktiviteetit (irrallinen tekstilohko aiheen sisällä) eivät linkkaa
// mihinkään view.php-sivuun kuten muut materiaalit, joten niitä ei löydy
// extractItems-funktiolla - sisältö on jo valmiiksi aiheen HTML:ssä.
function extractLabelItems(chunk) {
  const items = [];
  const re = /class="[^"]*\bmodtype_label\b[^"]*"/g;
  let m;
  while ((m = re.exec(chunk))) {
    const windowEnd = Math.min(chunk.length, m.index + 8000);
    const window_ = chunk.slice(m.index, windowEnd);
    const nameMatch = window_.match(/data-activityname="([^"]*)"/);
    const title = nameMatch ? decodeEntities(nameMatch[1]).trim() : "";
    if (!title) continue;
    const found = findDivContent(chunk, "no-overflow", m.index);
    const content = found ? htmlToText(found.content) : "";
    if (!content) continue;
    items.push({ index: m.index, title, url: null, type: "label", content });
  }
  return items;
}

function extractItems(chunk) {
  const items = [];
  const seen = new Set();
  const re = /<a[^>]+href="([^"]*\/mod\/([a-z0-9]+)\/view\.php\?id=\d+[^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(chunk))) {
    const url = decodeEntities(m[1]);
    const type = m[2];
    let inner = m[3];
    // "instancename" sisältää usein sisäkkäisen <span class="accesshide"> Tehtävä</span> -pätkän
    // (ruudunlukijoille) - poistetaan se ENNEN otsikon poimintaa, koska muuten sisäkkäinen
    // </span> katkaisisi instancename-haun väärästä kohdasta (regex ei osaa pesiä spanejä).
    inner = inner.replace(/<span[^>]*class="[^"]*accesshide[^"]*"[^>]*>[\s\S]*?<\/span>/gi, "");
    const nameMatch = inner.match(/<span[^>]*class="[^"]*instancename[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
    let title = nameMatch ? nameMatch[1] : inner;
    title = decodeEntities(stripTags(title)).trim();
    if (!title) continue;
    const key = url + "|" + title;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ index: m.index, title, url, type });
  }

  // Yhdistetään label-aktiviteetit (ei linkkiä) samaan listaan, alkuperäisessä
  // järjestyksessä, ja poistetaan apuna käytetty "index"-kenttä lopuksi.
  const merged = items.concat(extractLabelItems(chunk)).sort((a, b) => a.index - b.index);
  return merged.map(({ index, ...rest }) => rest);
}

function parseCoursePage(html) {
  const sections = splitSections(html);
  const topics = [];
  sections.forEach((s) => {
    const name = extractSectionName(s.html, s.num);
    const summary = extractSectionSummary(s.html);
    const items = extractItems(s.html);
    // Ohitetaan täysin tyhjät "Yleiset"-osiot (usein pelkkä ilmoitusfoorumi tms. jää pois koska
    // sillä ei ole /mod/*/view.php-linkkiä matchattavana tässä muodossa - ei haittaa).
    if (items.length === 0 && !summary && !/aihe|topic/i.test(name)) return;
    topics.push({ name, summary, items });
  });
  return topics;
}

// "page"-tyyppisten materiaalien (mod/page) varsinainen sisältö ei ole aiheen
// omalla sivulla, vaan pitää hakea materiaalin omalta view.php-sivulta
// erikseen. Labeleilla (type "label") on jo sisältö valmiina, ei haeta uudelleen.
function extractPageMainContent(html) {
  const found = findDivContent(html, "no-overflow", 0);
  if (!found) return "";
  return htmlToText(found.content);
}

async function enrichTextContent(topics, session, opts) {
  for (const topic of topics) {
    for (const item of topic.items) {
      if (!TEXT_CONTENT_TYPES.has(item.type) || item.content || !item.url) continue;
      try {
        const html = await fetchMoodlePage(item.url, session);
        const content = extractPageMainContent(html);
        if (content) item.content = content;
      } catch (err) {
        if (opts.debug) console.log(`    (sisällön haku epäonnistui "${item.title}": ${err.message})`);
      }
      await sleep(opts.delay);
    }
  }
}

// Tämä Moodle-instanssi käyttää kurssin "tabs"-formaattia: jokainen aihe on
// oma välilehti jolla on oma sivunsa (course/view.php?id=X&section=N), ei
// kaikki aiheita samalla sivulla. Välilehtipalkki (kaikki aiheet + niiden
// oikeat nimet) on kuitenkin mukana JOKAISELLA kurssin sivulla, joten se
// löytyy jo ensimmäisestä hausta - poimitaan sieltä aihenumerot ja nimet,
// ja haetaan jokainen aihe omalta sivultaan erikseen.
function extractSectionTabs(html) {
  const tabs = [];
  const re = /<a\s+class="([^"]*\bnav-link\b[^"]*)"\s+href="([^"]*)"[^>]*title="([^"]*)"[^>]*>/g;
  let m;
  while ((m = re.exec(html))) {
    const classAttr = m[1];
    const href = decodeEntities(m[2]);
    const title = decodeEntities(m[3])
      .replace(/[​-‍﻿]/g, "")
      .trim();
    const secMatch = href.match(/[?&]section=(\d+)/);
    if (!secMatch) continue;
    tabs.push({ num: Number(secMatch[1]), title, disabled: /\bdisabled\b/.test(classAttr) });
  }
  const seen = new Map();
  tabs.forEach((t) => {
    if (!seen.has(t.num)) seen.set(t.num, t);
  });
  return [...seen.values()].sort((a, b) => a.num - b.num);
}

// Hakee kurssin kaikkien aiheiden materiaalit. baseHtml on jo haettu
// oletussivu (course/view.php?id=X ilman section-parametria) - jos siltä
// löytyy välilehtinavigaatio, käydään jokainen aihe läpi omalta sivultaan;
// muuten oletetaan perinteinen yksisivuinen "topics"-muoto.
async function scrapeCourseTopics(course, baseHtml, session, baseUrl, opts) {
  const tabs = extractSectionTabs(baseHtml);
  let topics;

  if (tabs.length === 0) {
    topics = parseCoursePage(baseHtml);
  } else {
    topics = [];
    for (const tab of tabs) {
      if (tab.disabled) {
        if (opts.debug) console.log(`    (ohitetaan piilotettu aihe: "${tab.title}")`);
        continue;
      }
      let html;
      if (tab.num === 0) {
        html = baseHtml;
      } else {
        const url = `${baseUrl}/course/view.php?id=${course.moodleId}&section=${tab.num}`;
        html = await fetchMoodlePage(url, session);
        await sleep(opts.delay);
      }
      const sections = splitSections(html);
      const match = sections.find((s) => Number(s.num) === tab.num);
      const chunk = match ? match.html : html;
      const summary = extractSectionSummary(chunk);
      const items = extractItems(chunk);
      const name = tab.title || extractSectionName(chunk, String(tab.num));
      topics.push({ name, summary, items });
    }
  }

  await enrichTextContent(topics, session, opts);
  return topics;
}

async function fetchMoodlePage(url, session) {
  const res = await fetch(url, {
    redirect: "manual",
    headers: {
      Cookie: `MoodleSession=${session}`,
      "User-Agent": "Mozilla/5.0 (dashboard-scrape-script)",
    },
  });
  if (res.status >= 300 && res.status < 400) {
    throw new Error(
      "Palvelin ohjasi uudelleen (todennäköisesti kirjautumissivulle) - MoodleSession-eväste on vanhentunut, hae uusi selaimesta."
    );
  }
  const html = await res.text();
  if (looksLikeLoginPage(html)) {
    throw new Error("Sivu näyttää kirjautumissivulta - MoodleSession-eväste on vanhentunut tai väärä.");
  }
  return html;
}

async function fetchCoursePage(courseId, session, baseUrl) {
  return fetchMoodlePage(`${baseUrl}/course/view.php?id=${courseId}`, session);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const opts = parseArgs();

  // Jos MOODLE_USERNAME/MOODLE_PASSWORD on asetettu .env:iin, tarkistetaan
  // ja tarvittaessa uusitaan MoodleSession automaattisesti ennen kuin
  // lähdetään hakemaan mitään -- silloin --session-lippua tai
  // MOODLE_SESSION-arvoa ei enää tarvitse ylläpitää käsin.
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

  const data = JSON.parse(fs.readFileSync(DATA_JSON_PATH, "utf8"));
  const courses = data.filter((c) => c.moodleId && (opts.course == null || c.moodleId === opts.course));

  if (courses.length === 0) {
    console.log(
      opts.course != null
        ? `Kurssia jonka moodleId on ${opts.course} ei löytynyt data.json:ista.`
        : "Yhdelläkään kurssilla ei ole moodleId-kenttää data/data.json:issa - aja ensin npm run find-ids tai dashboardin Hae Moodlesta."
    );
    return;
  }

  let anyChanged = false;

  for (let i = 0; i < courses.length; i++) {
    const course = courses[i];
    process.stdout.write(`[${course.id}] haetaan course/view.php?id=${course.moodleId} ... `);
    let html;
    try {
      html = await fetchCoursePage(course.moodleId, opts.session, opts.baseUrl);
    } catch (err) {
      console.log("VIRHE");
      console.error("  " + err.message);
      continue;
    }

    if (opts.debug) {
      const debugPath = debugFile(`debug_course_${course.moodleId}.html`);
      fs.writeFileSync(debugPath, html);
      console.log(`\n  (debug: koko sivu tallennettu -> ${path.basename(debugPath)})`);
      process.stdout.write("  jäsennetään ... ");
    }

    const topics = await scrapeCourseTopics(course, html, opts.session, opts.baseUrl, opts);
    const itemCount = topics.reduce((s, t) => s + t.items.length, 0);
    console.log(`${topics.length} aihealuetta, ${itemCount} materiaalia/linkkiä.`);

    if (itemCount === 0 && !opts.debug) {
      const debugPath = debugFile(`debug_course_${course.moodleId}.html`);
      fs.writeFileSync(debugPath, html);
      console.log(
        `  Ei löytynyt yhtään materiaalia - tallensin koko sivun tiedostoon ${path.basename(debugPath)} tarkistusta varten.`
      );
    }

    if (!opts.dryRun) {
      course.topics = topics;
      anyChanged = true;
    }

    if (i < courses.length - 1) await sleep(opts.delay);
  }

  if (opts.dryRun) {
    console.log("\n--dry-run: mitään ei kirjoitettu data.json:iin.");
    return;
  }

  if (anyChanged) {
    fs.writeFileSync(DATA_JSON_PATH, JSON.stringify(data, null, 2) + "\n");
    buildDataJs(data);
    console.log("data.json ja data.js päivitetty.");
  }
}

// module.exports asetetaan ENNEN main():in käynnistystä, koska main()
// kutsuu (tarvittaessa) refresh_moodle_session.js:ää, joka puolestaan
// requirettaa tämän tiedoston takaisin (kehämäinen require) - jos
// module.exports asetettaisiin vasta tämän jälkeen, se require palauttaisi
// vielä tyhjän exports-objektin.
module.exports = {
  parseCoursePage,
  splitSections,
  extractSectionName,
  extractItems,
  extractSectionTabs,
  extractSectionSummary,
  extractLabelItems,
  extractPageMainContent,
  findDivContent,
  htmlToText,
  enrichTextContent,
  scrapeCourseTopics,
  decodeEntities,
  stripTags,
  looksLikeLoginPage,
  fetchMoodlePage,
  TEXT_CONTENT_TYPES,
  BASE_URL,
};

if (require.main === module) {
  main().catch((err) => {
    console.error("Odottamaton virhe:", err);
    process.exit(1);
  });
}
