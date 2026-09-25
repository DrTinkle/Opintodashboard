// exam_windows.js
//
// EXAM-tenttien varausikkunat kurssin Moodle-sivun tekstistä.
//
// EXAM-järjestelmä (exam5x.samk.fi) on Moodlesta erillinen palvelu, joten
// EXAM-tenteillä ei ole Moodlessa aktiviteettia eikä "Due:"-päivää.
// Opettajat kirjoittavat tentin ikkunan kurssin etusivulle tai osion
// tekstiin, esim.
//   "https://exam5x.samk.fi/enrolments/155529?code=IC250112    12.10.-1.11.2026"
//   "Tentti 7.–22.11.2026: (ilmoittautumislinkit julkaistaan myöhemmin)"
// Tämä moduuli etsii tekstistä rivit, joilla on päivämääräväli ja jotka
// liittyvät tenttiin. Uusintatentit ohitetaan.
//
// Rivi hyväksytään, jos
//   - kurssin tekstissä mainitaan EXAM (sana tai exam5x-linkki), ja
//   - rivillä on päivämääräväli, ja
//   - rivillä tai sitä edeltävällä rivillä on EXAM-linkki tai sana
//     "tentti"/"exam", eikä kummallakaan rivillä ole sanaa "uusinta".

const EXAM_LINK_RE = /https?:\/\/exam\w*\.samk\.fi\/[^\s)"]*/i;
// "exam" omana sanana tai taivutettuna (Examissa, EXAM-tentti), ei "examples"
const EXAM_WORD_RE = /\bexam(?:\b|issa|ista|iin|iä|ia|-)/i;
const EXAM_CONTEXT_RE = /tentti|\bexam(?:\b|issa|ista|iin|iä|ia|-)/i;
const RETAKE_RE = /uusinta/i;
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

// Kaikki kurssin tekstit: osioiden kuvaukset ja tekstisisältöiset kohteet.
function collectTexts(topics) {
  const texts = [];
  for (const t of topics || []) {
    if (t.summary) texts.push(t.summary);
    for (const it of t.items || []) if (it.content) texts.push(it.content);
  }
  return texts;
}

function findExamWindows(topics) {
  const texts = collectTexts(topics);
  const all = texts.join("\n");
  if (!EXAM_LINK_RE.test(all) && !EXAM_WORD_RE.test(all)) return [];
  const found = new Map();
  for (const text of texts) {
    const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
    lines.forEach((line, i) => {
      const range = parseDateRange(line);
      if (!range) return;
      const prev = i > 0 ? lines[i - 1] : "";
      if (RETAKE_RE.test(line) || RETAKE_RE.test(prev)) return;
      const link = (line.match(EXAM_LINK_RE) || prev.match(EXAM_LINK_RE) || [null])[0];
      if (!link && !EXAM_CONTEXT_RE.test(line) && !EXAM_CONTEXT_RE.test(prev)) return;
      const key = range.start + "|" + range.end;
      if (found.has(key)) return;
      found.set(key, { ...range, link, context: (prev ? prev + "\n" : "") + line });
    });
  }
  return [...found.values()];
}

module.exports = { findExamWindows, parseDateRange };
