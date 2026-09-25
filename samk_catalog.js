#!/usr/bin/env node
// samk_catalog.js
//
// Täydentää data.json:in kurssien puuttuvat tiedot (kurssikoodi,
// opintopisteet, alkamis- ja päättymispäivä, opettaja) SAMKin julkisesta
// opinto-oppaasta (https://samk.opinto-opas.fi). Ei vaadi kirjautumista.
//
// Periaatteet:
//   - Täyttää VAIN puuttuvia kenttiä, ei koskaan ylikirjoita olemassa olevaa.
//   - Kun kurssilla on koodi, haetaan sillä (varmin). Muuten kurssin nimellä.
//   - Jos saman kurssin toteutuksia on useita (eri ryhmät), valitaan se,
//     jonka ryhmä on sama kuin käyttäjän muilla kursseilla. Jos valinta ei
//     silti ole yksiselitteinen, täytetään vain tiedot jotka ovat kaikissa
//     vaihtoehdoissa samat (tyypillisesti opintopisteet).
//   - Opinto-opas on valinnainen lisä: jos se ei vastaa tai sen rakenne
//     muuttuu, mitään ei kaadu, tiedot vain jäävät täyttämättä.
//
// Opinto-oppaan rajapinta on sivuston oma, dokumentoimaton taustarajapinta
// (/app/rest/), joten SAMK voi muuttaa sitä ilman ilmoitusta.
//
// Käyttö:
//   node samk_catalog.js             # täydentää data.json:in ja päivittää data.js:n
//   node samk_catalog.js --dry-run   # näyttää mitä täytettäisiin, ei kirjoita
//
// Sama logiikka ajetaan automaattisesti "Hae Moodlesta" -synkan lopuksi
// (sync_moodle.js), joten uusien kurssien tiedot täyttyvät itsestään.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const CATALOG_BASE = "https://samk.opinto-opas.fi/app/rest/";
const REQUEST_TIMEOUT_MS = 30000;
const DATA_JSON_PATH = path.join(__dirname, "data.json");
const BUILD_JS_PATH = path.join(__dirname, "build.js");

// Opinto-oppaan toteutuskoodi, esim. "IC250105-3002" (opintojakso + toteutus).
const REALIZATION_CODE_RE = /\b([A-Z]{2,}[0-9A-Z]{3,}-\d{4})\b/;

async function fetchJson(url, options = {}) {
  const res = await fetch(url, { ...options, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`opinto-opas vastasi HTTP ${res.status} (${url})`);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("opinto-oppaan vastaus ei ollut JSON:ia (rajapinta on voinut muuttua)");
  }
}

// Lukuvuosi niin kuin opinto-opas sen laskee: elokuusta alkaen uusi vuosi.
function academicYear(date = new Date()) {
  return date.getMonth() < 7 ? date.getFullYear() - 1 : date.getFullYear();
}

function normalizeName(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(REALIZATION_CODE_RE, " ")
    .replace(/[^a-z0-9åäö]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function codeOf(course) {
  if (course.code) return String(course.code).trim().toUpperCase();
  const m = String(course.name || "").match(REALIZATION_CODE_RE);
  return m ? m[1] : null;
}

// "IC250105-3002" -> "IC", "SY221111" -> "SY"
function codePrefix(code) {
  const m = String(code || "").match(/^([A-Z]+)/);
  return m ? m[1] : null;
}

function groupCodes(realization) {
  return (realization.groups || []).map((g) => g.code).filter(Boolean);
}

function realizationName(r) {
  const n = (r.learningUnit && r.learningUnit.names) || r.names || {};
  return n.fi || n.en || "";
}

function needsCatalog(course) {
  return !course.code || course.credits == null || !course.start || !course.end || !course.teacher;
}

// Hakee kaikkien annettujen koulutusohjelmien toteutukset annetuille
// lukuvuosille. Yksi pyyntö per ohjelma ja vuosi.
async function loadRealizations(programmeIds, years) {
  const all = new Map();
  for (const year of years) {
    for (const degreeProgrammeId of programmeIds) {
      const body = {
        year,
        semester: null,
        degreeProgrammeId,
        officeId: null,
        startDate: null,
        endDate: null,
        enrollmentStartDate: null,
        enrollmentEndDate: null,
        tagIds: [],
        language: "fi",
      };
      const list = await fetchJson(CATALOG_BASE + "realization", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!Array.isArray(list)) throw new Error("opinto-oppaan hakutulos ei ollut lista");
      list.forEach((r) => r && r.id && all.set(r.id, r));
    }
  }
  return Array.from(all.values());
}

function userGroupSetting() {
  return String(process.env.SAMK_GROUP || "").trim().toUpperCase();
}

// Päättelee käyttäjän koulutusohjelman: ryhmätunnuksesta (SAMK_GROUP,
// esim. "AIC25SP" -> "IC") ja kurssikoodeista (esim. "IC250105-3002" -> "IC").
// Vain opinto-oppaan oikeat koulutusohjelmatunnukset kelpaavat.
function resolveProgrammeIds(data, programmes) {
  const wanted = new Set();
  const group = userGroupSetting();
  if (group) {
    const letters = (group.match(/^[A-Z]+/) || [""])[0];
    wanted.add(letters);
    wanted.add(letters.slice(1));
  }
  data.forEach((c) => {
    const p = codePrefix(codeOf(c));
    if (p) wanted.add(p);
  });
  return programmes.filter((p) => p && p.code && wanted.has(String(p.code).toUpperCase())).map((p) => p.id);
}

// Käyttäjän oma ryhmä (esim. "AIC25SP"): SAMK_GROUP-asetus, tai jos sitä ei
// ole, päätellään kursseista joilla on jo tarkka toteutuskoodi (yleisin
// ryhmä niiden toteutuksissa).
function inferUserGroups(data, realizations) {
  const group = userGroupSetting();
  if (group) return new Set([group]);
  const counts = new Map();
  data.forEach((c) => {
    const code = codeOf(c);
    if (!code) return;
    const r = realizations.find((x) => x.code === code);
    if (!r) return;
    groupCodes(r).forEach((g) => counts.set(g, (counts.get(g) || 0) + 1));
  });
  const max = Math.max(0, ...counts.values());
  return new Set([...counts].filter(([, n]) => n === max && n > 0).map(([g]) => g));
}

function findCandidates(course, realizations) {
  const code = codeOf(course);
  if (code) {
    const exact = realizations.filter((r) => r.code === code);
    if (exact.length) return exact;
    // Pelkkä opintojakson koodi (esim. "SY221111"): kaikki sen toteutukset.
    const byUnit = realizations.filter((r) => r.learningUnit && r.learningUnit.code === code);
    if (byUnit.length) return byUnit;
  }
  const name = normalizeName(course.name);
  if (!name) return [];
  const same = realizations.filter((r) => normalizeName(realizationName(r)) === name);
  if (same.length) return same;
  // Moodlen nimessä voi olla lisäosia ("..., syksy 2026"): hyväksytään, jos
  // opinto-oppaan nimi sisältyy Moodlen nimeen (tai päinvastoin) ja on
  // riittävän pitkä ollakseen yksilöivä.
  return realizations.filter((r) => {
    const rn = normalizeName(realizationName(r));
    return rn.length >= 8 && (name.includes(rn) || rn.includes(name));
  });
}

function narrowCandidates(course, candidates, userGroups) {
  let list = candidates;
  if (list.length > 1 && userGroups.size) {
    const inGroup = list.filter((r) => groupCodes(r).some((g) => userGroups.has(g)));
    if (inGroup.length) list = inGroup;
  }
  // Kurssin oma alkamispäivä, tai jos sitä ei ole, tämä päivä: suositaan
  // toteutusta, joka on silloin käynnissä.
  const day = course.start || new Date().toISOString().slice(0, 10);
  if (list.length > 1) {
    const covering = list.filter((r) => r.startDate && r.endDate && r.startDate <= day && day <= r.endDate);
    if (covering.length) list = covering;
  }
  return list;
}

function creditsOf(detail) {
  const v = detail.maxCredits != null ? detail.maxCredits : detail.minCredits;
  return typeof v === "number" && v > 0 ? v : null;
}

function teacherOf(detail) {
  const names = (detail.teachers || [])
    .map((t) => [t.firstName, t.lastName].filter(Boolean).join(" ").trim())
    .filter(Boolean);
  return names.length ? names.join(", ") : null;
}

// Täydentää data-taulukon kursseja paikan päällä. Palauttaa listan
// muutoksista: [{ id, name, fields: ["credits", ...] }].
async function enrichFromCatalog(data, { log = () => {} } = {}) {
  const targets = data.filter(needsCatalog);
  if (!targets.length) return [];

  const programmes = await fetchJson(CATALOG_BASE + "unit/degreeprogramme");
  if (!Array.isArray(programmes)) throw new Error("opinto-oppaan koulutusohjelmalista ei ollut lista");
  const programmeIds = resolveProgrammeIds(data, programmes);
  if (!programmeIds.length) {
    log(
      "Opinto-opas ohitettiin: koulutusohjelmaa ei voitu päätellä. Aseta " +
        "SAMK-ryhmätunnuksesi (esim. AIC25SP) Asetukset-välilehdellä."
    );
    return [];
  }

  const year = academicYear();
  const realizations = await loadRealizations(programmeIds, [year - 1, year]);
  const userGroups = inferUserGroups(data, realizations);
  const changes = [];

  for (const course of targets) {
    const candidates = narrowCandidates(course, findCandidates(course, realizations), userGroups);
    if (!candidates.length) continue;

    const details = [];
    for (const r of candidates.slice(0, 5)) details.push(await fetchJson(CATALOG_BASE + "realization/" + r.id));

    // Arvo kelpaa vain, jos se on sama kaikissa jäljellä olevissa vaihtoehdoissa.
    const agreed = (fn) => {
      const values = details.map(fn);
      return values.every((v) => v != null && v === values[0]) ? values[0] : null;
    };
    const found = {
      code: agreed((d) => d.code || null),
      credits: agreed(creditsOf),
      start: agreed((d) => d.startDate || null),
      end: agreed((d) => d.endDate || null),
      teacher: agreed(teacherOf),
    };

    const fields = [];
    for (const [key, value] of Object.entries(found)) {
      const missing = key === "credits" ? course.credits == null : !course[key];
      if (missing && value != null) {
        course[key] = value;
        fields.push(key);
      }
    }
    if (course.needsInfo && course.credits != null && course.start && course.end) delete course.needsInfo;
    if (fields.length) changes.push({ id: course.id, name: course.name, fields });
  }
  return changes;
}

const FIELD_LABELS = { code: "koodi", credits: "op", start: "alkaa", end: "päättyy", teacher: "opettaja" };

async function main() {
  require("./load_env.js").loadEnvFile();
  const dryRun = process.argv.includes("--dry-run");
  const data = JSON.parse(fs.readFileSync(DATA_JSON_PATH, "utf8"));
  const changes = await enrichFromCatalog(data, { log: (m) => console.log(m) });

  if (!changes.length) {
    console.log("Opinto-oppaasta ei löytynyt täydennettävää.");
    return;
  }
  console.log("Täydennetään opinto-oppaasta:");
  changes.forEach((c) => {
    const course = data.find((x) => x.id === c.id);
    const parts = c.fields.map((f) => `${FIELD_LABELS[f]}: ${course[f]}`);
    console.log(`  - ${c.name}: ${parts.join(", ")}`);
  });
  if (dryRun) {
    console.log("\n[DRY-RUN] Mitään ei kirjoitettu.");
    return;
  }
  fs.writeFileSync(DATA_JSON_PATH, JSON.stringify(data, null, 2) + "\n", "utf8");
  execFileSync(process.execPath, [BUILD_JS_PATH], { stdio: "inherit" });
}

module.exports = { enrichFromCatalog, academicYear, normalizeName, codePrefix, findCandidates, narrowCandidates };

if (require.main === module) {
  main().catch((err) => {
    console.error("Virhe:", err.message);
    process.exit(1);
  });
}
