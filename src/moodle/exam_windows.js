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
// Jokaiselta riviltä etsitään päivämäärät (välit ja yksittäiset päivät).
// Kunkin päivämäärän "konteksti" on teksti sen ja edellisen päivämäärän
// välissä (rivin ensimmäiselle myös edellinen rivi). Päivämäärä on tentti,
// jos sen kontekstissa mainitaan tentti tai on EXAM-linkki, eikä
// kontekstissa ole ohitettavia sanoja (uusinta, ilmoittautuminen,
// palautus, avautuminen...). Näin samalla rivillä olevat
// "Ilmoittautuminen 1.-7.10., tentti 14.10." ja "välikoe 1: 3.10.,
// välikoe 2: 7.11." tulkitaan oikein, ja "klo 12.10." on kellonaika.
//
// Tulos:
//   - päivämääräväli -> tentti-ikkuna. EXAM-ikkuna (system "exam"), jos
//     kontekstissa on EXAM-linkki tai kurssin tekstissä mainitaan EXAM
//     (eikä kontekstissa puhuta Moodlesta); muuten tavallinen ikkuna.
//   - yksittäinen päivä -> tentti sinä päivänä.

const EXAM_LINK_RE = /https?:\/\/exam\w*\.samk\.fi\/[^\s)"]*/i;
// "exam" omana sanana tai taivutettuna (Examissa, EXAM-tentti), ei "examples"
const EXAM_WORD_RE = /\bexam(?:\b|issa|ista|iin|iä|ia|-)/i;
const EXAM_CONTEXT_RE = /tentti|tentin|tenttiin|kuulustelu|välikoe|välikokee|loppukoe|loppukokee|\bexam(?:\b|issa|ista|iin|iä|ia|-)/i;
const TITLE_RE = /(välitentti|lopputentti|välikoe|loppukoe)/gi;
// Kontekstissa nämä tarkoittavat, ettei päivä ole itse tentti.
const SKIP_RE = /uusinta|ilmoittau|registration|enrol|re-?exam|retake|palautu|palautus|deadline/i;
// Yksittäinen päivä, joka kertoo vain avautumisesta, ei ole tentin päivä.
const SKIP_SINGLE_RE = /avautuu|aukeaa|opens?\b|alkaa\s*$/i;
const MOODLE_RE = /moodle/i;
const OPENS_RE = /avautuu|aukeaa|alkaa|opens?\b|alkaen/i;
const CLOSES_RE = /sulkeutuu|päättyy|closes?\b|asti|saakka/i;
const MAX_WINDOW_DAYS = 120;

function iso(y, m, d) {
  return y + "-" + String(m).padStart(2, "0") + "-" + String(d).padStart(2, "0");
}

function validDate(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// Vuosi päivälle, jolta se puuttuu: sama vuosi kuin ankkuri, tai seuraava
// jos päivä olisi ennen ankkuria. Ankkuri on kurssin alkupäivä, tai jos
// sitä ei ole, puoli vuotta taaksepäin tästä päivästä (ei tänään: jo
// mennyt tentti ei saa siirtyä seuraavalle vuodelle).
function inferYear(m, d, anchorIso) {
  let y = Number(anchorIso.slice(0, 4));
  if (validDate(y, m, d) && iso(y, m, d) < anchorIso) y++;
  return y;
}

function defaultAnchor(courseStart) {
  if (courseStart && /^\d{4}-\d{2}-\d{2}$/.test(courseStart)) return courseStart;
  const t = new Date(Date.now() - 182 * 86400000);
  return iso(t.getFullYear(), t.getMonth() + 1, t.getDate());
}

function daysBetweenIso(a, b) {
  return (Date.parse(b) - Date.parse(a)) / 86400000;
}

function rangeFrom(sd, sm, sy, ed, em, ey, anchorIso) {
  if (!ey) ey = inferYear(em, ed, anchorIso);
  if (!sm) sm = em;
  if (!sy) sy = sm > em ? ey - 1 : ey;
  if (!validDate(sy, sm, sd) || !validDate(ey, em, ed)) return null;
  const start = iso(sy, sm, sd);
  const end = iso(ey, em, ed);
  const days = daysBetweenIso(start, end);
  if (days < 0 || days > MAX_WINDOW_DAYS) return null;
  return { start, end };
}

// Etsii rivin päivämäärät järjestyksessä: { kind: "range"|"single", index,
// endIndex, start, end, date, fullYear }.
function findDates(line, anchorIso) {
  const found = [];
  const taken = [];
  const overlaps = (a, b) => taken.some(([x, y]) => a < y && b > x);

  const rangeRe = /(?<![\d.])(\d{1,2})\.(?:(\d{1,2})\.?)?(\d{4})?\s*[-–—]\s*(\d{1,2})\.(\d{1,2})\.(\d{4})?(?!\d)/g;
  let m;
  while ((m = rangeRe.exec(line))) {
    const r = rangeFrom(
      Number(m[1]),
      m[2] ? Number(m[2]) : null,
      m[3] ? Number(m[3]) : null,
      Number(m[4]),
      Number(m[5]),
      m[6] ? Number(m[6]) : null,
      anchorIso
    );
    if (!r) continue;
    found.push({ kind: "range", index: m.index, endIndex: m.index + m[0].length, ...r });
    taken.push([m.index, m.index + m[0].length]);
  }

  const singleRe = /(?<![\d.])(\d{1,2})\.(\d{1,2})\.(\d{4})?(?!\d)/g;
  while ((m = singleRe.exec(line))) {
    const a = m.index;
    const b = a + m[0].length;
    if (overlaps(a, b)) continue;
    const d = Number(m[1]);
    const mo = Number(m[2]);
    const y = m[3] ? Number(m[3]) : inferYear(mo, d, anchorIso);
    if (!validDate(y, mo, d)) continue;
    found.push({ kind: "single", index: a, endIndex: b, date: iso(y, mo, d), fullYear: !!m[3] });
  }

  found.sort((x, y) => x.index - y.index);

  // Kaksi täyttä päivämäärää, joiden välissä on vain välilyöntejä
  // (taulukkomuoto "9.11.2026  26.11.2026"), tai joista ensimmäisen
  // kontekstissa on avautuminen ja toisen sulkeutuminen, ovat väli.
  const merged = [];
  for (let i = 0; i < found.length; i++) {
    const a = found[i];
    const b = found[i + 1];
    if (a.kind === "single" && b && b.kind === "single" && a.fullYear && b.fullYear) {
      const between = line.slice(a.endIndex, b.index);
      const before = line.slice(i > 0 ? found[i - 1].endIndex : 0, a.index);
      const onlySpace = /^\s*$/.test(between);
      const openClose = OPENS_RE.test(before) && CLOSES_RE.test(between);
      const days = daysBetweenIso(a.date, b.date);
      if ((onlySpace || openClose) && days >= 0 && days <= MAX_WINDOW_DAYS) {
        merged.push({ kind: "range", index: a.index, endIndex: b.endIndex, start: a.date, end: b.date, openClose });
        i++;
        continue;
      }
    }
    merged.push(a);
  }
  return merged;
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

function titleFor(context) {
  const all = [...String(context).matchAll(TITLE_RE)];
  if (!all.length) return "Tentti";
  const w = all[all.length - 1][1];
  return w[0].toUpperCase() + w.slice(1).toLowerCase();
}

// Palauttaa listan:
//   { kind: "window", system: "exam"|"other", start, end, link, context }
//   { kind: "date", date, title, context }
function findTextExams(topics, course) {
  const texts = collectTexts(topics);
  const courseMentionsExam = texts.some((t) => EXAM_LINK_RE.test(t) || EXAM_WORD_RE.test(t));
  const anchorIso = defaultAnchor(course && course.start);
  const found = new Map();

  for (const text of texts) {
    const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
    lines.forEach((line, lineIdx) => {
      const prevLine = lineIdx > 0 ? lines[lineIdx - 1] : "";
      const dates = findDates(line, anchorIso);
      dates.forEach((dt, i) => {
        const ownContext = line.slice(i > 0 ? dates[i - 1].endIndex : 0, dt.index);
        // Rivin ensimmäiselle päivälle myös edellinen rivi (otsikkorivi tai
        // EXAM-linkki voi olla omalla rivillään).
        const context = i === 0 ? prevLine + "\n" + ownContext : ownContext;
        if (/klo\s*$/i.test(ownContext)) return; // kellonaika, ei päivä
        // Linkit pois ennen ohitussanoja: EXAM-linkin polussa on "enrolments".
        if (SKIP_RE.test(context.replace(/https?:\/\/\S+/gi, " "))) return;
        const link = (context.match(EXAM_LINK_RE) || line.slice(dt.endIndex).match(EXAM_LINK_RE) || [null])[0];
        const mentionsExam = EXAM_CONTEXT_RE.test(context) || !!(context.match(EXAM_LINK_RE));
        if (!mentionsExam) return;
        const fullContext = (i === 0 && prevLine ? prevLine + "\n" : "") + line;

        if (dt.kind === "range") {
          const isExamSystem = !!link || (courseMentionsExam && !MOODLE_RE.test(context));
          const key = "w|" + dt.start + "|" + dt.end;
          if (!found.has(key)) {
            found.set(key, {
              kind: "window",
              system: isExamSystem ? "exam" : "other",
              start: dt.start,
              end: dt.end,
              link,
              context: fullContext,
            });
          }
          return;
        }
        if (SKIP_SINGLE_RE.test(ownContext)) return;
        const key = "d|" + dt.date;
        if (!found.has(key)) found.set(key, { kind: "date", date: dt.date, title: titleFor(context), context: fullContext });
      });
    });
  }
  return [...found.values()];
}

module.exports = { findTextExams, findDates };
