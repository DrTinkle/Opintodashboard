// json_file.js
//
// data/data.json:n ja muiden tilatiedostojen turvallinen kirjoitus.
//
// - Kirjoitus tehdään ensin väliaikaistiedostoon ja nimetään sitten
//   oikealle nimelle. Kesken katkennut kirjoitus (kaatuminen, virta pois)
//   ei siis voi jättää puolikasta tiedostoa, jonka jälkeen JSON.parse
//   kaatuisi joka skriptissä.
// - readData() muistaa tiedoston muokkausajan, ja writeData() kieltäytyy
//   kirjoittamasta, jos tiedostoa on muokattu välissä (esim. käsin
//   editorissa pitkän Moodle-synkan aikana). Muuten synkka kirjoittaisi
//   käyttäjän muutokset yli vanhalla versiolla.

const fs = require("fs");
const { DATA_JSON_PATH } = require("./paths.js");

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function writeTextAtomic(filePath, text) {
  const tmp = filePath + ".tmp";
  fs.writeFileSync(tmp, text, "utf8");
  // Windowsissa virustorjunta tai editori voi pitää tiedostoa hetken auki,
  // jolloin rename epäonnistuu (EPERM/EBUSY). Yritetään muutaman kerran,
  // ja viimeisenä keinona kirjoitetaan suoraan.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      fs.renameSync(tmp, filePath);
      return;
    } catch (err) {
      if (!["EPERM", "EBUSY", "EACCES"].includes(err.code)) throw err;
      sleepSync(100);
    }
  }
  fs.writeFileSync(filePath, text, "utf8");
  try {
    fs.unlinkSync(tmp);
  } catch {
    /* ei haittaa */
  }
}

function writeJsonAtomic(filePath, obj) {
  writeTextAtomic(filePath, JSON.stringify(obj, null, 2) + "\n");
}

function mtimeOf(filePath) {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return null;
  }
}

// Palauttaa { data, mtimeMs }. mtimeMs annetaan myöhemmin writeData():lle.
function readData(filePath = DATA_JSON_PATH) {
  const mtimeMs = mtimeOf(filePath);
  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return { data, mtimeMs };
}

function writeData(data, expectedMtimeMs, filePath = DATA_JSON_PATH) {
  if (expectedMtimeMs != null) {
    const now = mtimeOf(filePath);
    if (now != null && now !== expectedMtimeMs) {
      throw new Error(
        "data/data.json muuttui ajon aikana (muokattiinko sitä samaan aikaan?). " +
          "Muutoksia ei tallennettu, jotta toisen muokkaukset eivät häviä. Aja uudelleen."
      );
    }
  }
  writeJsonAtomic(filePath, data);
}

module.exports = { writeTextAtomic, writeJsonAtomic, readData, writeData };
