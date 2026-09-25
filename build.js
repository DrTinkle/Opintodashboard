#!/usr/bin/env node
// build.js
//
// Generoi data.js -tiedoston data.json:ista. Aja tämä aina kun olet muokannut
// data.json:ia käsin, jotta dashboard (index.html) näkee muutokset:
//
//   node build.js

const fs = require("fs");
const path = require("path");

const DATA_JSON = path.join(__dirname, "data.json");
const DATA_JS = path.join(__dirname, "data.js");

function main() {
  const data = JSON.parse(fs.readFileSync(DATA_JSON, "utf8"));
  const header =
    "// Opintodashboardin data.\n" +
    "// TÄMÄ TIEDOSTO ON GENEROITU data.json:sta - älä muokkaa suoraan.\n" +
    '// Muokkaa data.json:ia ja aja "node build.js" (tai update_from_moodle.js).\n\n';
  fs.writeFileSync(DATA_JS, header + "const COURSES = " + JSON.stringify(data, null, 2) + ";\n", "utf8");
  console.log("data.js päivitetty (" + data.length + " kurssia).");
}

main();
