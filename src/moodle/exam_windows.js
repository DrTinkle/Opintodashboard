// exam_windows.js
//
// Tentit, jotka on kerrottu vain kurssin Moodle-sivun tekstissä.
//
// Moodle-quizina toteutetut tentit synkka löytää aktiviteetin omalta
// sivulta ("Closes:"). Muut tentit ovat vain tekstiä: EXAM-järjestelmä
// (exam5x.samk.fi) on Moodlesta erillinen, ja paperi- tai luokkatentistä
// opettaja kirjoittaa päivän kurssin etusivulle. Esimerkkejä:
//   "https://exam5x.samk.fi/enrolments/155529?code=IC250112    12.10.-1.11.2026"
//   "Tentti 7.–22.11.2026: (ilmoittautumislinkit julkaistaan myöhemmin)"
//   "tentti suoritetaan paperille keskiviikkona 14.10.2026 klo 17:00"
//
// Tekstistä poimitaan rivit, joilla tai joita edeltävällä rivillä
// mainitaan tentti (tai on EXAM-linkki) ja joilla on päivämäärä:
//   - päivämääräväli -> tenttiikkuna. EXAM-ikkunaksi (system "exam"), jos
//     rivillä tai edellisellä on EXAM-linkki tai kurssin tekstissä
//     mainitaan EXAM; muuten tavallinen ikkuna (system "other").
//   - yksittäinen päivä -> tentti sinä päivänä (kind "date"). Vain rivin
//     oma maininta kelpaa, ei edellisen rivin.
// Ohitetaan uusintatentit, ilmoittautumispäivät ja avautumispäivät.

const EXAM_LINK_RE = /https?:\/\/exam\w*\.samk\.fi\/[^\s)"]*/i;
// "exam" omana sanana tai taivutettuna (Examissa, EXAM-tentti), ei "examples"
const EXAM_WORD_RE = /\bexam(?:\b|issa|ista|iin|iä|ia|-)/i;
const EXAM_CONTEXT_RE = /tentti|tentin|kuulustelu|välikoe|loppukoe|\bexam(?:\b|issa|ista|iin|iä|ia|-)/i;
const TITLE_RE = /(välitentti|lopputentti|välikoe|loppukoe)/i;
const SKIP_RE = /uusinta/i;
const SKIP_DATE_RE = /ilmoittau|avautuu|aukeaa|opens/i;
const MAX_WINDOW_DAYS = 120;

function iso(y, m, d) {
  return y + "-" + String(m).padStart(2, "0") + "-" + String(d).padStart(2, "0");
}

function validDate(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// Palauttaa {start, end} ISO-muodossa tai null.
//   "12.10.-1.11.2026"  "7.–22.11.2026"  "9.11.2026  26.11.2026"
//   "avautuu 7.11.2026, sulkeutuu 22.11.2026"
function parseDateRange(line) {
  let s = null;
  let e = null;
  const a = line.match(/(\d{1,2})\.(?:(\d{1,2})\.?)?(?:(\d{4}))?\s*[-–—]\s*(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (a) {
    const ey = Number(a[6]);
    const em = Number(a[5]);
    const ed = Number(a[4]);
    const sm = a[2] ? Number(a[2]) : em;
    const sy = a[3] ? Number(a[3]) : sm > em ? ey - 1 : ey;
    s = [sy, sm, Number(a[1])];
    e = [ey, em, ed];
  } else {
    const full = [...line.matchAll(/(\d{1,2})\.(\d{1,2})\.(\d{4})/g)];
    if (full.length >= 2) {
      s = [Number(full[0][3]), Number(full[0][2]), Number(full[0][1])];
      e = [Number(full[1][3]), Number(full[1][2]), Number(full[1][1])];
    }
  }
  if (!s || !validDate(...s) || !validDate(...e)) return null;
  const start = iso(...s);
  const end = iso(...e);
  const days = (Date.parse(end) - Date.parse(start)) / 86400000;
  if (days < 0 || days > MAX_WINDOW_DAYS) return null;
  return { start, end };
}

// Yksittäinen päivä "14.10.2026" tai "14.10." (vuosi päätellään kurssin
// alkupäivästä: sama vuosi, tai seuraava jos päivä olisi ennen alkua).
function parseSingleDate(line, courseStart) {
  const m = line.match(/(?<![\d.])(\d{1,2})\.(\d{1,2})\.(\d{4})?(?![\d])/);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  let y = m[3] ? Number(m[3]) : null;
  if (!y) {
    const base = courseStart && /^\d{4}-\d{2}-\d{2}$/.test(courseStart) ? courseStart : new Date().toISOString().slice(0, 10);
    y = Number(base.slice(0, 4));
    if (validDate(y, mo, d) && iso(y, mo, d) < base) y++;
  }
  if (!validDate(y, mo, d)) return null;
  return iso(y, mo, d);
}

// Kaikki kurssin tekstit: osioiden kuvaukset ja tekstisisältöiset kohteet.
function collectTexts(topics) {
  const texts = [];
  for (const t of topics || []) {
    if (t.summary) texts.push(t.summary);
    for (const it of t.items || []) if (it.content) texts.push(it.content);
  }
  return texts;
}

function titleFor(line) {
  const m = line.match(TITLE_RE);
  if (!m) return "Tentti";
  return m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
}

// Palauttaa listan:
//   { kind: "window", system: "exam"|"other", start, end, link, context }
//   { kind: "date", date, title, context }
function findTextExams(topics, course) {
  const texts = collectTexts(topics);
  const courseMentionsExam = texts.some((t) => EXAM_LINK_RE.test(t) || EXAM_WORD_RE.test(t));
  const found = new Map();
  for (const text of texts) {
    const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
    lines.forEach((line, i) => {
      if (!/\d{1,2}\.\d{1,2}\./.test(line)) return;
      const prev = i > 0 ? lines[i - 1] : "";
      if (SKIP_RE.test(line) || SKIP_RE.test(prev)) return;
      const link = (line.match(EXAM_LINK_RE) || prev.match(EXAM_LINK_RE) || [null])[0];
      const range = parseDateRange(line);
      if (range) {
        if (!link && !EXAM_CONTEXT_RE.test(line) && !EXAM_CONTEXT_RE.test(prev)) return;
        const key = "w|" + range.start + "|" + range.end;
        if (!found.has(key)) {
          found.set(key, {
            kind: "window",
            system: link || courseMentionsExam ? "exam" : "other",
            ...range,
            link,
            context: line,
          });
        }
        return;
      }
      if (link || !EXAM_CONTEXT_RE.test(line) || SKIP_DATE_RE.test(line)) return;
      const date = parseSingleDate(line, course && course.start);
      if (!date) return;
      const key = "d|" + date;
      if (!found.has(key)) found.set(key, { kind: "date", date, title: titleFor(line), context: line });
    });
  }
  return [...found.values()];
}

module.exports = { findTextExams, parseDateRange, parseSingleDate };
