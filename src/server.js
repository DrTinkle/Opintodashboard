#!/usr/bin/env node
// server.js
//
// Pieni staattinen HTTP-palvelin dashboardin ajamiseen localhostin kautta
// (ei riippuvuuksia, pelkkää Node.js:n omaa http-moduulia).
//
// Käyttö:
//   node src/server.js
//   node src/server.js --port 3000
//
// Avaa sitten selaimessa osoitteen jonka skripti tulostaa (oletuksena
// http://localhost:8080). Selain avautuu myös automaattisesti.

const http = require("http");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");

const { PUBLIC_DIR, ENV_PATH, migrateLegacyFiles } = require("./paths.js");
const { readEnvFile } = require("./load_env.js");

// Vain public/-kansio tarjotaan selaimelle. Muut tiedostot (.env, data/,
// koodi) eivät ole haettavissa palvelimen kautta.
const ROOT = PUBLIC_DIR;

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

// Muuntaa pyynnön polun tiedostopoluksi public/-kansion sisällä. Palauttaa
// null, jos polku on virheellinen (rikkinäinen %-koodaus, nollatavu) tai
// osoittaa kansion ulkopuolelle ("..", myös "public_vanha"-tyyppiset
// sisarkansiot, siksi vertailu erottimen kanssa).
function safeJoin(root, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split("?")[0].split("#")[0]);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const resolved = path.normalize(path.join(root, decoded));
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
  return resolved;
}

// --- Pyyntöjen lähteen tarkistus ---
//
// Palvelin kuuntelee vain omaa konetta (127.0.0.1 ja ::1), joten muut
// laitteet samassa verkossa eivät pääse siihen. Lisäksi:
//   - Host-otsakkeen pitää olla localhost / 127.0.0.1 / [::1] oikealla
//     portilla. Estää DNS rebinding -hyökkäyksen, jossa vieras sivusto
//     ohjaa oman osoitteensa tähän palvelimeen.
//   - API-kutsuissa Origin-otsakkeen (jos selain lähettää sen) pitää olla
//     dashboard itse, eikä Sec-Fetch-Site saa olla "cross-site".
//   - POST-kutsujen sisältötyypin pitää olla application/json, jolloin
//     selain ei lähetä niitä toiselta sivustolta ilman CORS-esitarkistusta
//     (jota tämä palvelin ei hyväksy).
// Näin mikään muu verkkosivu ei voi muuttaa asetuksia, käynnistää synkkaa
// tai lukea kurssidataa.
function allowedHosts(port) {
  const hosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`]);
  if (port === 80) ["localhost", "127.0.0.1", "[::1]"].forEach((h) => hosts.add(h));
  return hosts;
}

function isAllowedHost(req, port) {
  return allowedHosts(port).has(String(req.headers.host || "").toLowerCase());
}

function isAllowedApiRequest(req, port) {
  const origin = req.headers.origin;
  if (origin !== undefined) {
    let parsed;
    try {
      parsed = new URL(origin);
    } catch {
      return false;
    }
    if (parsed.protocol !== "http:" || !allowedHosts(port).has(parsed.host.toLowerCase())) return false;
  }
  if (req.headers["sec-fetch-site"] === "cross-site") return false;
  if (req.method === "POST") {
    const type = String(req.headers["content-type"] || "").toLowerCase();
    if (!type.startsWith("application/json")) return false;
  }
  return true;
}

function sendJson(res, status, obj) {
  if (res.headersSent) return;
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
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
    ({ runSync } = require("./moodle/sync_moodle.js"));
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
    syncToGoogle = require("./integrations/sync_to_google.js");
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

// .env luetaan samalla jäsentimellä kuin skripteissä (load_env.js), jotta
// "asetettu"-tila vastaa sitä arvoa, jonka skriptit oikeasti saavat.
function handleSettingsStatusRequest(req, res) {
  let values;
  try {
    values = readEnvFile(ENV_PATH);
  } catch (err) {
    sendJson(res, 500, { ok: false, error: ".env-tiedoston luku epäonnistui: " + err.message });
    return;
  }
  const status = {};
  SETTINGS_KEYS.forEach((key) => {
    status[key] = !!(values[key] && values[key].length);
  });
  sendJson(res, 200, { ok: true, status });
}

// Kirjoittaa .env-tiedostoon vain pyydetyt muutokset rivi kerrallaan (KEY=
// -rivi korvataan jos löytyy, muuten lisätään loppuun), säilyttäen kaikki
// muut rivit (kommentit mukaan lukien) koskemattomina. Saman avaimen
// myöhemmät rivit poistetaan, jotta arvo on yksiselitteinen. Kirjoitus
// tehdään väliaikaistiedostoon ja nimetään sitten, jottei kesken jäänyt
// kirjoitus voi tyhjentää tiedostoa. Jos tiedostoa ei ole vielä olemassa,
// se luodaan tästä.
function writeEnvValues(updates) {
  let lines = [];
  try {
    lines = fs.readFileSync(ENV_PATH, "utf8").split(/\r?\n/);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  if (lines.length && lines[lines.length - 1] === "") lines.pop();

  const keyOf = (line) => {
    const t = line.trim();
    if (t.startsWith("#")) return null;
    const eq = t.indexOf("=");
    return eq === -1 ? null : t.slice(0, eq).trim();
  };
  Object.keys(updates).forEach((key) => {
    const newLine = key + "=" + updates[key];
    const first = lines.findIndex((line) => keyOf(line) === key);
    if (first === -1) {
      lines.push(newLine);
      return;
    }
    lines = lines.filter((line, i) => i <= first || keyOf(line) !== key);
    lines[first] = newLine;
  });

  const tmp = ENV_PATH + ".tmp";
  fs.writeFileSync(tmp, lines.join("\n") + "\n", "utf8");
  fs.renameSync(tmp, ENV_PATH);
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
    if (typeof set[key] !== "string") continue;
    const value = set[key].trim();
    // Rivinvaihto arvossa lisäisi .env:iin uuden rivin (eli uuden
    // asetuksen), joten sellaista ei hyväksytä.
    if (/[\r\n\0]/.test(value)) {
      sendJson(res, 400, { ok: false, error: key + ": arvossa ei saa olla rivinvaihtoja." });
      return;
    }
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

// Varmistaa ennen käynnistystä, että tiedostot ovat oikeissa paikoissa:
// siirtää vanhan kansiorakenteen tiedostot ja generoi public/data.js:n
// data/data.json:sta, jotta käsin tehdyt muutokset näkyvät aina, vaikka
// "npm run build" olisi unohtunut.
function prepareFiles() {
  const paths = require("./paths.js");
  migrateLegacyFiles().forEach((m) => console.log("Siirretty uuteen paikkaan: " + m));
  if (!fs.existsSync(paths.DATA_JSON_PATH)) {
    console.log('Huom: data/data.json puuttuu. Aja ensin "npm run setup".');
    return;
  }
  try {
    require("./build.js").buildDataJs();
  } catch (err) {
    console.error("Varoitus: data/data.json on virheellinen, käytetään edellistä public/data.js:ää (" + err.message + ")");
  }
}

function serveStatic(req, res) {
  const filePath = safeJoin(ROOT, req.url === "/" ? "/index.html" : req.url);
  if (!filePath) {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Virheellinen polku");
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("404 - tiedostoa ei löytynyt");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
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
}

const API_ROUTES = {
  "POST /api/sync-moodle": handleSyncRequest,
  "POST /api/sync-google": handleSyncGoogleRequest,
  "GET /api/settings/status": handleSettingsStatusRequest,
  "POST /api/settings": handleSettingsSaveRequest,
};

function handleRequest(req, res, port) {
  if (!isAllowedHost(req, port)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Kielletty: dashboardia voi käyttää vain osoitteesta http://localhost:" + port);
    return;
  }

  const urlPath = String(req.url || "/").split("?")[0];
  if (urlPath.startsWith("/api/")) {
    const route = API_ROUTES[req.method + " " + urlPath];
    if (!route) {
      sendJson(res, 404, { ok: false, error: "Tuntematon API-reitti." });
      return;
    }
    if (!isAllowedApiRequest(req, port)) {
      sendJson(res, 403, { ok: false, error: "Pyyntö hylättiin: se ei tullut dashboardilta itseltään." });
      return;
    }
    Promise.resolve(route(req, res)).catch((err) => {
      console.error("API-virhe:", err.message);
      sendJson(res, 500, { ok: false, error: err.message });
    });
    return;
  }

  serveStatic(req, res);
}

function main() {
  prepareFiles();
  const { port } = parseArgs();

  const handler = (req, res) => {
    try {
      handleRequest(req, res, port);
    } catch (err) {
      console.error("Pyynnön käsittely epäonnistui:", err.message);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Palvelinvirhe");
      }
    }
  };

  // Moodle-synkronointi voi kestää pari minuuttia (useita kursseja,
  // aktiviteetti kerrallaan), ja Google-vienti voi joutua odottamaan
  // selaimessa tehtävää kirjautumista jos token on vanhentunut - poistetaan
  // Noden oletusaikakatkaisut ettei pyyntöä katkaista kesken.
  const createServer = () => {
    const srv = http.createServer(handler);
    srv.requestTimeout = 0;
    srv.headersTimeout = 0;
    srv.timeout = 0;
    return srv;
  };

  // Kuunnellaan vain omaa konetta: IPv4 127.0.0.1 ja, jos koneessa on IPv6,
  // myös ::1 (selain voi yhdistää "localhost"-osoitteeseen kummalla
  // tahansa). Ei koskaan kaikkia verkkoliitäntöjä, jottei dashboard näy
  // muille laitteille samassa verkossa.
  const server = createServer();

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      // Jos portissa on jo käynnissä oleva dashboard (esim. kaynnista.bat
      // tuplaklikattu toiseen kertaan), avataan vain selain siihen.
      const url = `http://localhost:${port}`;
      fetch(`http://127.0.0.1:${port}/api/settings/status`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)
        .then((body) => {
          if (body && body.ok) {
            console.log(`Opintodashboard on jo käynnissä osoitteessa ${url}. Avataan selain.`);
            openInBrowser(url);
            setTimeout(() => process.exit(0), 1500);
          } else {
            console.error(`Portti ${port} on jo käytössä. Kokeile toista porttia: npm start -- --port 3000`);
            process.exit(1);
          }
        });
      return;
    }
    throw err;
  });

  server.listen(port, "127.0.0.1", () => {
    const server6 = createServer();
    server6.on("error", () => {
      /* ei IPv6:ta tai ::1 varattu: IPv4 riittää */
    });
    server6.listen(port, "::1");

    const url = `http://localhost:${port}`;
    console.log(`Opintodashboard käynnissä osoitteessa ${url}`);
    console.log("Pysäytä palvelin Ctrl+C:llä.");
    openInBrowser(url);
  });
}

main();
