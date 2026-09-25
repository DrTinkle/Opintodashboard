#!/usr/bin/env node
// setup.js - Opintodashboardin käyttöönotto yhdellä komennolla.
//
// Projektilla ei ole npm-riippuvuuksia (kaikki on tehty Node.js:n omilla
// moduuleilla), joten mitään ei ladata netistä. Tämä skripti:
//   1. tarkistaa että Node.js on riittävän uusi (vähintään 18, fetch-tuki)
//   2. siirtää vanhan kansiorakenteen omat tiedostot data/- ja debug/-kansioihin
//   3. luo data/data.json:in data/data.example.json:ista, jos omaa ei vielä ole
//   4. luo .env:in .env.example:sta, jos omaa ei vielä ole
//   5. generoi public/data.js:n
//
// Olemassa oleviin data.json- ja .env-tiedostoihin ei kosketa, joten
// skriptin voi ajaa turvallisesti uudelleen milloin tahansa.
//
// Käyttö: npm run setup   (tai: node src/setup.js, tai Windowsissa setup.bat)

const fs = require("fs");
const path = require("path");
const paths = require("./paths.js");

const { ROOT } = paths;
const MIN_NODE_MAJOR = 18;

function step(msg) {
  console.log("  - " + msg);
}

function fail(msg) {
  console.error("\nVirhe: " + msg + "\n");
  process.exit(1);
}

console.log("\nOpintodashboard: käyttöönotto\n");

const major = Number(process.versions.node.split(".")[0]);
if (!(major >= MIN_NODE_MAJOR)) {
  fail(
    `Node.js ${process.versions.node} on liian vanha. Tarvitaan vähintään ` +
      `versio ${MIN_NODE_MAJOR}. Asenna uusin LTS-versio: https://nodejs.org`
  );
}
step(`Node.js ${process.versions.node} (vaatimus >= ${MIN_NODE_MAJOR}) OK`);

function copyIfMissing(srcPath, dstPath, note) {
  const src = path.relative(ROOT, srcPath);
  const dst = path.relative(ROOT, dstPath);
  if (fs.existsSync(dstPath)) {
    step(`${dst} on jo olemassa, jätetään ennalleen`);
    return;
  }
  if (!fs.existsSync(srcPath)) fail(`${src} puuttuu, lataa repo uudelleen.`);
  fs.mkdirSync(path.dirname(dstPath), { recursive: true });
  fs.copyFileSync(srcPath, dstPath);
  step(`${dst} luotu (${note})`);
}

const moved = paths.migrateLegacyFiles();
moved.forEach((m) => step("siirretty uuteen paikkaan: " + m));

copyIfMissing(paths.DATA_EXAMPLE_PATH, paths.DATA_JSON_PATH, "esimerkkikurssit, korvaa omillasi");
copyIfMissing(paths.ENV_EXAMPLE_PATH, paths.ENV_PATH, "tyhjä asetuspohja, täytetään Asetukset-välilehdellä");

try {
  require("./build.js").buildDataJs();
  step("public/data.js generoitu data/data.json:sta");
} catch (err) {
  fail("data.js:n generointi epäonnistui: " + err.message);
}

const startHint =
  process.platform === "win32"
    ? "tuplaklikkaa kaynnista.bat (tai työpöydän pikakuvaketta)"
    : "npm start      (tai: node src/server.js)";

console.log(`
Valmis! Seuraavaksi:

  1. Käynnistä dashboard:   ${startHint}
  2. Selain avautuu osoitteeseen http://localhost:8080
  3. Avaa Asetukset-välilehti, täytä Moodle-kirjautuminen ja ryhmätunnus,
     ja paina sitten "Hae Moodlesta".
`);
