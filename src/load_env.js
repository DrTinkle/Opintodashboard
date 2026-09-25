// load_env.js
//
// Pieni riippumaton .env-lukija (ei npm-pakettia, ei asennuksia). Lukee
// KEY=VALUE-rivit .env-tiedostosta ja asettaa ne process.env:iin, jos
// samannimista muuttujaa ei ole jo asetettu (esim. oikea ymparistomuuttuja
// voittaa aina .env-tiedoston).
//
// Kayttö skripteissa:
//   require('../load_env.js').loadEnvFile();   (src/moodle- tai src/integrations-kansiosta)
//
// .env-tiedosto ei ole pakollinen -- jos sita ei loydy, tama ei tee mitaan
// eika kaadu.

const fs = require("fs");
const { ENV_PATH } = require("./paths.js");

// Jäsentää .env-tiedoston sisällön { KEY: value } -olioksi. Kommentit ja
// tyhjät rivit ohitetaan, ympäröivät lainausmerkit poistetaan. Jos sama
// avain on useammin kuin kerran, ENSIMMÄINEN voittaa. Samaa jäsennintä
// käyttävät sekä skriptit (loadEnvFile) että server.js:n Asetukset-reitit,
// jotta "asetettu"-tila ja todellinen arvo eivät voi erota.
function parseEnv(content) {
  const values = {};
  String(content || "")
    .split(/\r?\n/)
    .forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return;
      const eq = trimmed.indexOf("=");
      if (eq === -1) return;
      const key = trimmed.slice(0, eq).trim();
      if (!key || key in values) return;
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

function readEnvFile(envPath) {
  try {
    return parseEnv(fs.readFileSync(envPath || ENV_PATH, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return {};
    throw err;
  }
}

function loadEnvFile(envPath) {
  const values = readEnvFile(envPath);
  for (const [key, value] of Object.entries(values)) {
    if (!(key in process.env)) process.env[key] = value;
  }
}

module.exports = { loadEnvFile, parseEnv, readEnvFile };
