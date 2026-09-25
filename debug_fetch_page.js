#!/usr/bin/env node
// debug_fetch_page.js -- TILAPAINEN apuskripti. Hakee annetun Moodle-sivun
// (esim. yhden tehtavan tai tentin osoitteen) ja tallentaa raa'an HTML:n
// tiedostoon debug_fetch_<id>.html, jotta sisallon oikea rakenne voidaan
// tarkistaa ilman etta mitaan tarvitsee liittaa chattiin. Ei tee mitaan
// Moodleen, pelkka GET-pyynto. Voit poistaa taman tiedoston kun
// find_deadlines.js:n sisallonpoiminta on saatu korjattua.
//
// Kaytto:
//   node debug_fetch_page.js "https://moodle5.samk.fi/mod/assign/view.php?id=75278"

const fs = require("fs");
const path = require("path");
require("./load_env.js").loadEnvFile();
const { fetchMoodlePage } = require("./scrape_course_content.js");
const { ensureFreshSession } = require("./refresh_moodle_session.js");

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error('Anna Moodle-sivun osoite parametrina: node debug_fetch_page.js "https://..."');
    process.exit(1);
  }

  let session = process.env.MOODLE_SESSION || null;
  if (process.env.MOODLE_USERNAME && process.env.MOODLE_PASSWORD) {
    const result = await ensureFreshSession(session);
    if (result.session) session = result.session;
  }
  if (!session) {
    console.error("MoodleSession puuttuu.");
    process.exit(1);
  }

  const html = await fetchMoodlePage(url, session);
  const idMatch = url.match(/[?&]id=(\d+)/);
  const outName = `debug_fetch_${idMatch ? idMatch[1] : Date.now()}.html`;
  const outPath = path.join(__dirname, outName);
  fs.writeFileSync(outPath, html);
  console.log(`Tallennettu: ${outName} (${html.length} merkkia)`);
}

main().catch((err) => {
  console.error("Virhe:", err.message);
  process.exit(1);
});
