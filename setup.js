#!/usr/bin/env node
// setup.js - Opintodashboardin käyttöönotto yhdellä komennolla.
//
// Projektilla ei ole npm-riippuvuuksia (kaikki on tehty Node.js:n omilla
// moduuleilla), joten mitään ei ladata netistä. Tämä skripti:
//   1. tarkistaa että Node.js on riittävän uusi (vähintään 18, fetch-tuki)
//   2. luo data.json:in data.example.json:ista, jos omaa ei vielä ole
//   3. luo .env:in .env.example:sta, jos omaa ei vielä ole
//   4. generoi data.js:n (node build.js)
//
// Olemassa oleviin data.json- ja .env-tiedostoihin ei kosketa, joten
// skriptin voi ajaa turvallisesti uudelleen milloin tahansa.
//
// Käyttö: npm run setup   (tai: node setup.js, tai Windowsissa setup.bat)

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = __dirname;
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

function copyIfMissing(src, dst, note) {
  const srcPath = path.join(ROOT, src);
  const dstPath = path.join(ROOT, dst);
  if (fs.existsSync(dstPath)) {
    step(`${dst} on jo olemassa, jätetään ennalleen`);
    return;
  }
  if (!fs.existsSync(srcPath)) fail(`${src} puuttuu, lataa repo uudelleen.`);
  fs.copyFileSync(srcPath, dstPath);
  step(`${dst} luotu (${note})`);
}

copyIfMissing("data.example.json", "data.json", "esimerkkikurssit, korvaa omillasi");
copyIfMissing(".env.example", ".env", "tyhjä asetuspohja, täytetään Asetukset-välilehdellä");

try {
  execFileSync(process.execPath, [path.join(ROOT, "build.js")], { cwd: ROOT, stdio: "pipe" });
  step("data.js generoitu data.json:sta");
} catch (err) {
  fail("data.js:n generointi epäonnistui: " + (err.stderr ? String(err.stderr).trim() : err.message));
}

console.log(`
Valmis! Seuraavaksi:

  1. Käynnistä dashboard:   npm start      (tai: node server.js)
  2. Selain avautuu osoitteeseen http://localhost:8080
  3. Avaa Asetukset-välilehti ja täytä Moodle-kirjautuminen sekä oma
     Moodle-käyttäjä-id, ja paina sitten "Hae Moodlesta".
`);
