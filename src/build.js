#!/usr/bin/env node
// build.js
//
// Generoi public/data.js:n data/data.json:ista. Dashboard (public/index.html)
// lukee kurssidatan data.js:stä. Aja tämä aina, kun olet muokannut
// data.json:ia käsin:
//
//   npm run build
//
// Muut skriptit kutsuvat buildDataJs()-funktiota suoraan kirjoitettuaan
// data.json:in.

const fs = require("fs");
const path = require("path");
const { DATA_JSON_PATH, DATA_JS_PATH } = require("./paths.js");

function buildDataJs(data) {
  const courses = data || JSON.parse(fs.readFileSync(DATA_JSON_PATH, "utf8"));
  const header =
    "// Opintodashboardin data.\n" +
    "// TÄMÄ TIEDOSTO ON GENEROITU data/data.json:sta - älä muokkaa suoraan.\n" +
    '// Muokkaa data/data.json:ia ja aja "npm run build".\n\n';
  fs.mkdirSync(path.dirname(DATA_JS_PATH), { recursive: true });
  fs.writeFileSync(DATA_JS_PATH, header + "const COURSES = " + JSON.stringify(courses, null, 2) + ";\n", "utf8");
  return courses.length;
}

module.exports = { buildDataJs };

if (require.main === module) {
  const count = buildDataJs();
  console.log("data.js päivitetty (" + count + " kurssia).");
}
