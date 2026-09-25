#!/usr/bin/env node
// server.js
//
// Pieni staattinen HTTP-palvelin dashboardin ajamiseen localhostin kautta
// (ei riippuvuuksia, pelkkää Node.js:n omaa http-moduulia).
//
// Käyttö:
//   node server.js
//   node server.js --port 3000
//
// Avaa sitten selaimessa osoitteen jonka skripti tulostaa (oletuksena
// http://localhost:8080). Selain avautuu myös automaattisesti.

const http = require("http");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");

const ROOT = __dirname;

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { port: 8080 };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--port") out.port = Number(args[++i]);
  }
  return out;
}

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
};

function openInBrowser(url) {
  const platform = process.platform;
  const cmd =
    platform === "win32" ? `start "" "${url}"` : platform === "darwin" ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => {
    /* jos avaaminen epäonnistuu, käyttäjä voi avata linkin itse - ei kaadeta serveriä tästä */
  });
}

function safeJoin(root, urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const resolved = path.normalize(path.join(root, decoded));
  if (!resolved.startsWith(root)) return null; // estä hakemistosta ulos pääsy ("..")
  return resolved;
}

// "Hae uudet Moodlesta" -nappi dashboardilla kutsuu tätä (POST, ei runkoa).
// Serveri on käynnissä käyttäjän omalla koneella (jolla on netti Moodleen,
// toisin kuin missä tahansa pilvi-sandboxissa), joten tämä on ainoa paikka
// josta sync_moodle.js:n voi oikeasti ajaa selaimen napista käsin.
// Yhden ajon lukko (isSyncing) estää kaksi päällekkäistä ajoa jos nappia
// klikkaa vahingossa kahdesti - toinen pyyntö saa heti 409:n.
let isSyncing = false;

function handleSyncRequest(req, res) {
  if (isSyncing) {
    res.writeHead(409, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false, error: "Synkronointi on jo käynnissä, odota sen valmistumista." }));
    return;
  }
  isSyncing = true;
  console.log("Aloitetaan Moodle-synkronointi (dashboardin napista)...");

  // Ladataan sync_moodle.js vasta tässä (ei tiedoston alussa), jotta
  // server.js voi käynnistyä ja palvella dashboardia normaalisti vaikka
  // sync_moodle.js:ssä olisi jokin virhe skriptiä ladattaessa.
  let runSync;
  try {
    ({ runSync } = require("./sync_moodle.js"));
  } catch (err) {
    isSyncing = false;
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false, error: "sync_moodle.js:n lataus epäonnistui: " + err.message }));
    return;
  }

  runSync()
    .then((summary) => {
      console.log(
        `Moodle-synkronointi valmis: ${summary.newCourses.length} uutta kurssia, ` +
          `${summary.newTasks.length} uutta tehtävää, ${summary.errors.length} virhettä.`
      );
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true, summary }));
    })
    .catch((err) => {
      console.error("Moodle-synkronointi epäonnistui:", err);
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    })
    .finally(() => {
      isSyncing = false;
    });
}

// "Vie Google-kalenteriin" -nappi dashboardilla kutsuu tätä (POST, ei
// runkoa). Sama periaate kuin Moodle-synkassa: serveri pyörii käyttäjän omalla
// koneella jolla on netti Googleen (pilvi-sandbox ei pääse sinne), joten
// tämä on ainoa paikka josta sync_to_google.js:n voi oikeasti ajaa
// selaimen napista käsin. Oma lukko (isSyncingGoogle), erillinen
// Moodle-synkan lukosta, jotta kumpikin synkka voi tarvittaessa olla
// omillaan.
let isSyncingGoogle = false;

function handleSyncGoogleRequest(req, res) {
  if (isSyncingGoogle) {
    res.writeHead(409, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false, error: "Google-vienti on jo käynnissä, odota sen valmistumista." }));
    return;
  }
  isSyncingGoogle = true;
  console.log("Aloitetaan Google-kalenterivienti (dashboardin napista)...");

  // Ladataan sync_to_google.js vasta tässä (ei tiedoston alussa), samasta
  // syystä kuin sync_moodle.js Moodle-reitillä.
  let syncToGoogle;
  try {
    syncToGoogle = require("./sync_to_google.js");
  } catch (err) {
    isSyncingGoogle = false;
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false, error: "sync_to_google.js:n lataus epäonnistui: " + err.message }));
    return;
  }

  // Annetaan asetukset suoraan (ei jätetä sync_to_google.js:ää lukemaan
  // server.js:n omaa process.argv:ia - server.js voi olla käynnistetty esim.
  // "--port 3000" -lipulla eikä se saa vaikuttaa Google-vientiin).
  syncToGoogle
    .main({})
    .then((summary) => {
      console.log(
        `Google-vienti valmis: luotu ${summary.created}, päivitetty ${summary.updated}, ennallaan ${summary.skipped}.`
      );
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true, summary }));
    })
    .catch((err) => {
      console.error("Google-vienti epäonnistui:", err);
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    })
    .finally(() => {
      isSyncingGoogle = false;
    });
}


// Asetukset-sivun (#asetukset) API: kaikki .env-pohjaiset parametrit
// (Moodle-kirjautuminen, Google-OAuth, DeepSeek-avain) muokattavaksi
// dashboardista käsin sen sijaan että .env-tiedostoa pitäisi muokata käsin -
// tarpeen nyt kun dashboardista tehdään jaettava repo luokkalaisille.
//
// Turvallisuusperiaate: GET-reitti kertoo VAIN
// onko kukin avain jo asetettu (true/false), ei koskaan itse arvoa - arvot
// eivät koskaan kulje takaisin selaimeen. POST-reitti kirjoittaa vain ne
// avaimet jotka käyttäjä juuri syötti tai pyysi tyhjennettäväksi, säilyttäen
// .env-tiedoston muut rivit (kommentit mukaan lukien) sellaisenaan. Vain
// tunnetut avaimet (SETTINGS_KEYS) hyväksytään, jottei mielivaltaisia rivejä
// voi kirjoittaa tiedostoon.
const ENV_PATH = path.join(ROOT, ".env");
const SETTINGS_KEYS = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "MOODLE_USERNAME",
  "MOODLE_PASSWORD",
  "MOODLE_SESSION",
  "MOODLE_USERID",
  "SAMK_GROUP",
  "DEEPSEEK_API_KEY",
];

// Lukee .env:in KEY=VALUE-rivit map:iksi ilman että koskee process.env:iin.
// Sama yksinkertainen parseri kuin load_env.js:ssä (kommentit/tyhjät rivit
// ohitetaan, ei tueta rivinvaihtoja arvon sisällä).
function readEnvValues() {
  const values = {};
  let content;
  try {
    content = fs.readFileSync(ENV_PATH, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return values;
    throw err;
  }
  content.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const eq = trimmed.indexOf("=");
    if (eq === -1) return;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  });
  return values;
}

function handleSettingsStatusRequest(req, res) {
  const values = readEnvValues();
  const status = {};
  SETTINGS_KEYS.forEach((key) => {
    status[key] = !!(values[key] && values[key].length);
  });
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ ok: true, status }));
}

// Kirjoittaa .env-tiedostoon vain pyydetyt muutokset rivi kerrallaan (KEY=
// -rivi korvataan jos löytyy, muuten lisätään loppuun), säilyttäen kaikki
// muut rivit (kommentit mukaan lukien) koskemattomina. Jos tiedostoa ei ole
// vielä olemassa, se luodaan tästä.
function writeEnvValues(updates) {
  let lines = [];
  try {
    lines = fs.readFileSync(ENV_PATH, "utf8").split(/\r?\n/);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  if (lines.length && lines[lines.length - 1] === "") lines.pop();

  Object.keys(updates).forEach((key) => {
    const newLine = key + "=" + updates[key];
    let found = false;
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq !== -1 && trimmed.slice(0, eq).trim() === key) {
        lines[i] = newLine;
        found = true;
        break;
      }
    }
    if (!found) lines.push(newLine);
  });

  fs.writeFileSync(ENV_PATH, lines.join("\n") + "\n", "utf8");
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1e6) req.destroy(); // järjettömän suuri pyyntö - ei anneta kasvaa loputtomiin
    });
    req.on("end", () => resolve(raw));
    req.on("error", reject);
  });
}

async function handleSettingsSaveRequest(req, res) {
  let body;
  try {
    const raw = await readRequestBody(req);
    body = JSON.parse(raw || "{}");
  } catch (err) {
    res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false, error: "Virheellinen pyyntö (ei kelvollista JSON:ia)." }));
    return;
  }

  const set = (body && body.set) || {};
  const clear = Array.isArray(body && body.clear) ? body.clear : [];
  const updates = {};

  for (const key of Object.keys(set)) {
    if (!SETTINGS_KEYS.includes(key)) continue;
    const value = String(set[key]);
    if (value) updates[key] = value;
  }
  for (const key of clear) {
    if (!SETTINGS_KEYS.includes(key)) continue;
    updates[key] = "";
  }

  if (!Object.keys(updates).length) {
    res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false, error: "Ei tunnistettuja muutoksia." }));
    return;
  }

  try {
    writeEnvValues(updates);
    // Päivitetään myös käynnissä olevan palvelimen process.env, jotta uudet
    // arvot ovat heti käytössä (esim. "Hae Moodlesta" heti tallennuksen
    // jälkeen) ilman palvelimen uudelleenkäynnistystä. load_env.js ei
    // ylikirjoita jo asetettuja avaimia, joten tämä on ainoa paikka jossa
    // muutos päivittyy ajonaikaisesti.
    for (const [key, value] of Object.entries(updates)) {
      if (value) process.env[key] = value;
      else delete process.env[key];
    }
    // Ei ikinä lokiteta arvoja, vain mitkä AVAIMET muuttuivat.
    console.log("Asetukset päivitetty (.env): " + Object.keys(updates).join(", "));
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, updatedKeys: Object.keys(updates) }));
  } catch (err) {
    console.error("Asetusten tallennus epäonnistui:", err.message);
    res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false, error: err.message }));
  }
}

function main() {
  const { port } = parseArgs();

  const server = http.createServer((req, res) => {
    if (req.method === "POST" && req.url === "/api/sync-moodle") {
      handleSyncRequest(req, res);
      return;
    }

    if (req.method === "POST" && req.url === "/api/sync-google") {
      handleSyncGoogleRequest(req, res);
      return;
    }

    if (req.method === "GET" && req.url === "/api/settings/status") {
      handleSettingsStatusRequest(req, res);
      return;
    }

    if (req.method === "POST" && req.url === "/api/settings") {
      handleSettingsSaveRequest(req, res);
      return;
    }

    let filePath = safeJoin(ROOT, req.url === "/" ? "/index.html" : req.url);
    if (!filePath) {
      res.writeHead(400);
      res.end("Virheellinen polku");
      return;
    }

    fs.stat(filePath, (err, stats) => {
      if (err || !stats.isFile()) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("404 - tiedostoa ei löytynyt: " + req.url);
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || "application/octet-stream";

      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(500);
          res.end("Palvelinvirhe");
          return;
        }
        // "no-cache" jokaiselle tiedostolle: dashboard lukee data.js:n
        // sisällön ladatessaan sivun, ja synkronoinnin jälkeisen
        // sivunlatauksen pitää aina saada tuorein data.js eikä selaimen
        // välimuistista jäänyttä vanhaa versiota.
        res.writeHead(200, { "Content-Type": contentType, "Cache-Control": "no-cache" });
        res.end(data);
      });
    });
  });

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(`Portti ${port} on jo käytössä. Kokeile toista porttia: node server.js --port 3000`);
      process.exit(1);
    }
    throw err;
  });

  // Moodle-synkronointi voi kestää pari minuuttia (useita kursseja,
  // aktiviteetti kerrallaan), ja Google-vienti voi joutua odottamaan
  // selaimessa tehtävää kirjautumista jos token on vanhentunut - poistetaan
  // Noden oletusaikakatkaisut ettei pyyntöä katkaista kesken.
  server.requestTimeout = 0;
  server.headersTimeout = 0;
  server.timeout = 0;

  server.listen(port, () => {
    const url = `http://localhost:${port}`;
    console.log(`Opintodashboard käynnissä osoitteessa ${url}`);
    console.log("Pysäytä palvelin Ctrl+C:llä.");
    openInBrowser(url);
  });
}

main();
