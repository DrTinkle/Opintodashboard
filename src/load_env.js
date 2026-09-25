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

function loadEnvFile(envPath) {
  const target = envPath || ENV_PATH;
  let content;
  try {
    content = fs.readFileSync(target, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return;
    throw err;
  }

  content.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const eq = trimmed.indexOf("=");
    if (eq === -1) return;
    const key = trimmed.slice(0, eq).trim();
    if (!key) return;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  });
}

module.exports = { loadEnvFile };
