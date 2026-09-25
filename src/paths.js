// paths.js
//
// Kaikki projektin tiedostopolut yhdessä paikassa. Skriptit eivät rakenna
// polkuja itse (__dirname + tiedostonimi), vaan käyttävät näitä, joten
// kansiorakenteen muuttaminen vaatii muutoksen vain tähän tiedostoon.
//
// Rakenne:
//   public/   selaimelle tarjottavat tiedostot (index.html, generoitu data.js)
//   data/     omat tiedot: kurssidata, Google-kirjautuminen, synkkojen tila
//             (vain data.example.json on gitissä)
//   debug/    vianetsinnän HTML-tallenteet (ei gitissä)
//   src/      koodi
//   .env      asetukset ja kirjautumistiedot (projektin juuressa)

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const PUBLIC_DIR = path.join(ROOT, "public");
const DEBUG_DIR = path.join(ROOT, "debug");

const paths = {
  ROOT,
  DATA_DIR,
  PUBLIC_DIR,
  DEBUG_DIR,
  ENV_PATH: path.join(ROOT, ".env"),
  ENV_EXAMPLE_PATH: path.join(ROOT, ".env.example"),
  DATA_JSON_PATH: path.join(DATA_DIR, "data.json"),
  DATA_EXAMPLE_PATH: path.join(DATA_DIR, "data.example.json"),
  DATA_JS_PATH: path.join(PUBLIC_DIR, "data.js"),
  CREDENTIALS_PATH: path.join(DATA_DIR, "credentials.json"),
  TOKEN_PATH: path.join(DATA_DIR, "token.json"),
  SYNC_STATE_PATH: path.join(DATA_DIR, "sync_state.json"),
  SYNC_REPORT_PATH: path.join(DATA_DIR, "sync_report.json"),
  DEADLINE_SCAN_PATH: path.join(DATA_DIR, "deadline_scan.json"),
};

// Polku debug/-kansioon (kansio luodaan tarvittaessa).
function debugFile(name) {
  fs.mkdirSync(DEBUG_DIR, { recursive: true });
  return path.join(DEBUG_DIR, name);
}

// Siirtää vanhan kansiorakenteen (kaikki tiedostot juuressa) omat tiedostot
// uusiin paikkoihinsa. Turvallinen ajaa useasti: siirtää vain, jos kohdetta
// ei vielä ole. Palauttaa listan siirroista.
function migrateLegacyFiles() {
  const moved = [];
  const move = (from, to) => {
    if (!fs.existsSync(from) || fs.existsSync(to)) return;
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.renameSync(from, to);
    moved.push(path.relative(ROOT, from) + " -> " + path.relative(ROOT, to));
  };
  ["data.json", "data.json.bak", "credentials.json", "token.json", "sync_state.json", "sync_report.json", "deadline_scan.json"]
    .forEach((name) => move(path.join(ROOT, name), path.join(DATA_DIR, name)));
  move(path.join(ROOT, "data.js"), paths.DATA_JS_PATH);
  let rootFiles = [];
  try {
    rootFiles = fs.readdirSync(ROOT);
  } catch {}
  rootFiles
    .filter((name) => /^debug_.*\.html$/.test(name))
    .forEach((name) => move(path.join(ROOT, name), path.join(DEBUG_DIR, name)));
  return moved;
}

module.exports = { ...paths, debugFile, migrateLegacyFiles };
