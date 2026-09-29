// moodle_dates.js
//
// Moodlen aktiviteettisivun päivämäärien jäsennys kielestä riippumatta.
//
// Moodle näyttää sivut käyttäjän kielellä, eikä skripti pakota kieltä.
// Tehtäväsivun data-region="activity-dates"-lohkossa on rivejä
// "Otsikko: päivämäärä", esimerkiksi
//   englanniksi: "Due: Wednesday, 14 October 2026, 11:59 PM"
//                "Closes: Sunday, 27 September 2026, 4:00 PM"
//   suomeksi:    "Palautettavissa alkaen: maanantaina 31. elokuuta 2026, 00.00"
//                "Palautettava viimeistään: keskiviikkona 14. lokakuuta 2026, 23.59"
//                "Avautui: tiistaina 15. syyskuuta 2026, 14.15"
//                "Sulkeutui: sunnuntai 27. syyskuuta 2026, 16.00"
// (suomenkieliset esimerkit ovat SAMKin Moodlesta 29.9.2026)
// Rivin otsikko luokitellaan avainsanoista (avautuminen, sulkeutuminen,
// määräaika) ja päivämäärä luetaan joko kuukauden nimestä (englanti tai
// suomi) tai numeromuodosta 14.10.2026. Näin jäsennys toimii, vaikka
// Moodlen tarkka suomenkielinen otsikko vaihtelisi versiosta toiseen.

const MONTHS_EN = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};
// Suomen kuukaudet taivutusmuodoissa: "lokakuu", "lokakuun", "lokakuuta".
const MONTHS_FI = [
  "tammi", "helmi", "maalis", "huhti", "touko", "kesä", "heinä", "elo", "syys", "loka", "marras", "joulu",
];

function monthFromWord(word) {
  const w = String(word || "").toLowerCase();
  if (MONTHS_EN[w]) return MONTHS_EN[w];
  const fi = w.match(/^(tammi|helmi|maalis|huhti|touko|kesä|heinä|elo|syys|loka|marras|joulu)kuu/);
  return fi ? MONTHS_FI.indexOf(fi[1]) + 1 : null;
}

function iso(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return y + "-" + String(m).padStart(2, "0") + "-" + String(d).padStart(2, "0");
}

// Ensimmäinen päivämäärä tekstissä ISO-muodossa, tai null.
//   "Wednesday, 14 October 2026"   "keskiviikko, 14. lokakuuta 2026"
//   "October 14, 2026"              "14.10.2026"
// Pehmeät tavuviivat pois ja sitovat välilyönnit tavallisiksi.
function normalize(text) {
  return String(text || "").replace(/\u00ad/g, "").replace(/[\u00a0\u202f]/g, " ");
}

function parseDateText(text) {
  const s = normalize(text);
  const candidates = [];
  let m;
  const named = /(\d{1,2})\.?\s+([A-Za-zÄÖÅäöå]+)\s+(\d{4})/g;
  while ((m = named.exec(s))) {
    const month = monthFromWord(m[2]);
    if (month) candidates.push({ index: m.index, iso: iso(Number(m[3]), month, Number(m[1])) });
  }
  const us = /([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/g;
  while ((m = us.exec(s))) {
    const month = monthFromWord(m[1]);
    if (month) candidates.push({ index: m.index, iso: iso(Number(m[3]), month, Number(m[2])) });
  }
  const numeric = /(?<![\d.])(\d{1,2})\.(\d{1,2})\.(\d{4})(?!\d)/g;
  while ((m = numeric.exec(s))) {
    candidates.push({ index: m.index, iso: iso(Number(m[3]), Number(m[2]), Number(m[1])) });
  }
  const valid = candidates.filter((c) => c.iso).sort((a, b) => a.index - b.index);
  return valid.length ? valid[0].iso : null;
}

// Rivin otsikon luokitus. Avautuminen tarkistetaan ensin: esim.
// "Palautukset alkavat:" sisältää sanan palautus mutta ei ole määräaika.
const OPEN_RE = /open|avautu|avattu|avoinna|alka|alko|allow submissions|from/i;
const CLOSE_RE = /close|sulkeutu|suljettu|sulkeu|päätty|cut-?off|until/i;
const DUE_RE = /due|määräaika|määräpäivä|palautettava|palautuspäivä|palautus|deadline|viimeistään/i;

function classifyLabel(label) {
  if (OPEN_RE.test(label)) return "open";
  if (CLOSE_RE.test(label)) return "close";
  if (DUE_RE.test(label)) return "due";
  return null;
}

// Jakaa activity-dates-tekstin riveiksi {label, kind, date}. Otsikko on
// kaksoispistettä edeltävä sanaosuus; kellonajan kaksoispiste ("11:59")
// ei kelpaa otsikon päätteeksi, koska sitä edeltää numero.
function parseActivityDateLines(text) {
  const s = normalize(text);
  const re = /([A-Za-zÄÖÅäöå][A-Za-zÄÖÅäöå \-]{0,40}?)\s*:\s*/g;
  const marks = [];
  let m;
  while ((m = re.exec(s))) marks.push({ label: m[1].trim(), start: m.index, valueStart: re.lastIndex });
  return marks.map((mk, i) => {
    const value = s.slice(mk.valueStart, i + 1 < marks.length ? marks[i + 1].start : s.length);
    return { label: mk.label, kind: classifyLabel(mk.label), date: parseDateText(value) };
  });
}

// Määräaika: "Due"/määräpäivä ensin, sitten sulkeutuminen (quizit). Avautuminen
// ei ole määräaika.
function parseDueDate(activityDatesText) {
  const lines = parseActivityDateLines(activityDatesText).filter((l) => l.date);
  const due = lines.find((l) => l.kind === "due");
  if (due) return due.date;
  const close = lines.find((l) => l.kind === "close");
  return close ? close.date : null;
}

module.exports = { parseDueDate, parseDateText, parseActivityDateLines, monthFromWord };
