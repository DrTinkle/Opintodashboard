#!/usr/bin/env node
// sync_to_google.js
//
// Vie data.json:in deadlinet Google Tasksiin (palautettavat tehtavat) ja
// Google Calendariin (tentit, labrat, muut aikaan sidotut). Zero
// dependency -- kayttaa vain Node:n omaa fetch:ia ja kevytta paikallista
// OAuth2-loopback-kirjautumista, ei mitaan npm install -paketteja.
//
// KAYTTOONOTTO (tehdaan kerran):
//   Katso README.md:n osio "Google-kalenterisynkka" -- lyhyesti: luo Google
//   Cloud -projekti, ota Tasks API ja Calendar API kayttoon, luo OAuth-client
//   (tyyppi "Desktop app"), lataa credentials.json talle kansiolle.
//
// KAYTTO:
//   node sync_to_google.js                    # kirjautuu tarv. selaimen kautta, synkkaa kaiken
//   node sync_to_google.js --dry-run          # nayttaa mita tehtaisiin, ei muuta mitaan
//   node sync_to_google.js --course <kurssin-id>       # vain yksi kurssi
//   node sync_to_google.js --tasklist "Oma lista" --calendar "Oma kalenteri"
//   node sync_to_google.js --logout           # poistaa tallennetun kirjautumisen (token.json)
//
// Idempotentti: ajaminen uudelleen paivittaa jo luodut rivit sen sijaan
// etta loisi kopioita (muistetaan sync_state.json:issa). Jos deadline
// poistetaan data.json:ista, sen Google-rivi jaa ennalleen -- tata skriptia
// ei (viela) siivoa poistettuja rivejä pois Googlesta.

const fs = require("fs");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const { spawn } = require("child_process");
require("./load_env.js").loadEnvFile();

const DATA_JSON_PATH = path.join(__dirname, "data.json");
const CREDENTIALS_PATH = path.join(__dirname, "credentials.json");
const TOKEN_PATH = path.join(__dirname, "token.json");
const STATE_PATH = path.join(__dirname, "sync_state.json");

const SCOPES = ["https://www.googleapis.com/auth/tasks", "https://www.googleapis.com/auth/calendar"];
const DEFAULT_TASKLIST_NAME = "Koulu - Deadlinet";
const DEFAULT_CALENDAR_NAME = "Koulu";
const TASKS_API = "https://tasks.googleapis.com/tasks/v1";
const CAL_API = "https://www.googleapis.com/calendar/v3";

// "Paivaa ennen" -muistutus JOKAiselle deadlinelle (myos Tasks-tyyppisille,
// koska Google Tasks ei tue saadettavaa muistutusaikaa APIn kautta) - kevyt
// erillinen kalenteritapahtuma varsinaisen Task/Calendar-merkinnan rinnalla.
const REMINDER_DAYS_BEFORE = 1;
const REMINDER_TIME_START = "18:00";
const REMINDER_TIME_END = "18:15";
// EXAM-ajanvarausmuistutus: sama luku kuin dashboardin oma
// EXAM_BOOKING_HORIZON_DAYS (index.html) - EXAM-jarjestelmassa ajan voi
// varata vain n. taman verran vuorokausia etukateen, joten (examWindowEnd -
// EXAM_BOOKING_HORIZON_DAYS) on hetki jolloin koko ikkuna avautuu kokonaan
// varattavaksi.
const EXAM_BOOKING_HORIZON_DAYS = 30;
const EXAM_REMINDER_TIME_START = "09:00";
const EXAM_REMINDER_TIME_END = "09:15";
const TIME_ZONE = "Europe/Helsinki";

function parseArgs(argv) {
  const out = {
    dryRun: false,
    tasklistName: DEFAULT_TASKLIST_NAME,
    calendarName: DEFAULT_CALENDAR_NAME,
    logout: false,
    course: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--tasklist") out.tasklistName = argv[++i];
    else if (a === "--calendar") out.calendarName = argv[++i];
    else if (a === "--logout") out.logout = true;
    else if (a === "--course") out.course = argv[++i];
  }
  return out;
}

function loadJson(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return fallback;
    throw err;
  }
}

function saveJson(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n");
}

function shortHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}

// Sama deadline tunnistetaan kurssin + paivan + otsikon perusteella (data.json:in
// deadlineilla ei ole omaa id-kenttaa). Jos otsikko muuttuu isosti, skripti
// luo sille uuden rivin Googleen eika osaa yhdistaa sita vanhaan.
function deadlineKey(course, deadline) {
  return `${course.id}::${deadline.date}::${deadline.title}`;
}

function isTaskType(deadline) {
  return deadline.type === "task";
}

// yyyy-mm-dd + N paivaa -> yyyy-mm-dd. Kalenterin koko paivan tapahtuman
// "end"-paiva on Google Calendarissa eksklusiivinen (seuraava paiva).
function addDays(isoDate, n) {
  const d = new Date(isoDate + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function buildTaskBody(course, deadline) {
  return {
    title: `[${course.name}] ${deadline.title}`,
    notes: deadline.notes || "",
    due: `${deadline.date}T00:00:00.000Z`,
  };
}

function buildEventBody(course, deadline) {
  return {
    summary: `[${course.name}] ${deadline.title}`,
    description: deadline.notes || "",
    start: { date: deadline.date },
    end: { date: addDays(deadline.date, 1) },
  };
}

// dateStr ("YYYY-MM-DD") + timeStr ("HH:MM") paikallisena (koneen omana)
// kellonaikana on jo menneisyydessa nyt-hetkeen nahden. Kone oletetaan
// olevan Suomen aikavyohykkeessa (kayttajan oma tietokone).
function isInPast(dateStr, timeStr) {
  return new Date(`${dateStr}T${timeStr}:00`).getTime() < Date.now();
}

// "Paivaa ennen" -muistutus (kaikille tyypeille) - erillinen ajastettu
// kalenteritapahtuma, jonka popup-ilmoitus laukeaa heti sen alkaessa
// (REMINDER_DAYS_BEFORE vrk ennen varsinaista maaraaikaa, klo
// REMINDER_TIME_START). Nain se toimii tasmalleen samalla tavalla riippumatta
// siita meneeko varsinainen kohde Tasksiin vai Calendariin.
function buildDayBeforeReminderBody(course, deadline) {
  const reminderDate = addDays(deadline.date, -REMINDER_DAYS_BEFORE);
  return {
    summary: `🔔 ${course.name}: ${deadline.title} – määräaika huomenna`,
    description:
      `Muistutus Opintodashboardista. Varsinainen määräaika: ${deadline.date}.` +
      (deadline.notes ? `\n\n${deadline.notes}` : ""),
    start: { dateTime: `${reminderDate}T${REMINDER_TIME_START}:00`, timeZone: TIME_ZONE },
    end: { dateTime: `${reminderDate}T${REMINDER_TIME_END}:00`, timeZone: TIME_ZONE },
    reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 0 }] },
  };
}

// EXAM-ajanvarausmuistutus: ajastettu EXAM_BOOKING_HORIZON_DAYS vrk ennen
// examWindowEnd:ia - sama hetki jolloin dashboardin oma getExamAvailability()
// (index.html) alkaisi nayttaa koko ikkunan olevan auki. Ei tieda oletko jo
// varannut ajan (se tieto on vain selaimen localStoragessa, katso main():n
// kommentti), joten tama tulee aina kun examWindowEnd on tiedossa.
function buildExamBookingReminderBody(course, deadline, examReminderDate) {
  return {
    summary: `📌 ${course.name}: EXAM-ikkuna kokonaan auki nyt — muista varata!`,
    description:
      `EXAM-järjestelmässä pitäisi nyt näkyä varattavia aikoja koko ikkunan loppuun asti ` +
      `(${deadline.examWindowStart || "?"}–${deadline.examWindowEnd}). Muistutus Opintodashboardista.`,
    start: { dateTime: `${examReminderDate}T${EXAM_REMINDER_TIME_START}:00`, timeZone: TIME_ZONE },
    end: { dateTime: `${examReminderDate}T${EXAM_REMINDER_TIME_END}:00`, timeZone: TIME_ZONE },
    reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 0 }] },
  };
}

function openBrowser(url) {
  try {
    if (process.platform === "win32") {
      // HUOM: "cmd /c start" ei kay, koska cmd.exe tulkitsee URL:in &-merkit
      // komentojen erottimiksi ja katkaisee osoitteen ensimmaiseen &:aan --
      // Google nakee talloin vain osan parametreista (esim. response_type
      // puuttuu) vaikka skripti rakensi koko osoitteen oikein. rundll32:n
      // url.dll,FileProtocolHandler ei mene cmd.exe:n kautta, joten se avaa
      // koko osoitteen sellaisenaan.
      spawn("rundll32", ["url.dll,FileProtocolHandler", url], {
        stdio: "ignore",
        detached: true,
        windowsHide: true,
      }).unref();
    } else if (process.platform === "darwin") {
      spawn("open", [url], { stdio: "ignore", detached: true }).unref();
    } else {
      spawn("xdg-open", [url], { stdio: "ignore", detached: true }).unref();
    }
  } catch (err) {
    // Selaimen automaattinen avaus ei ole pakollinen, linkki tulostetaan joka tapauksessa.
  }
}

// --- OAuth2 (loopback-kirjautuminen, sama periaate kuin Google Cloud SDK / gcloud kayttaa) ---

function loginWithBrowser(creds) {
  return new Promise((resolve, reject) => {
    let port;
    const server = http.createServer((req, res) => {
      handleOAuthCallback(req, res, creds, port, server, resolve, reject);
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      port = server.address().port;
      const redirectUri = `http://127.0.0.1:${port}`;
      const authUrl = new URL(creds.auth_uri);
      authUrl.searchParams.set("client_id", creds.client_id);
      authUrl.searchParams.set("redirect_uri", redirectUri);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("scope", SCOPES.join(" "));
      authUrl.searchParams.set("access_type", "offline");
      authUrl.searchParams.set("prompt", "consent");

      console.log("\nAvataan selain Google-kirjautumista varten.");
      console.log("Jos selain ei avaudu itsestaan, kopioi tama linkki selaimeen:\n");
      console.log(authUrl.toString() + "\n");
      openBrowser(authUrl.toString());
    });
  });
}

async function handleOAuthCallback(req, res, creds, port, server, resolve, reject) {
  try {
    const url = new URL(req.url, "http://127.0.0.1");
    const error = url.searchParams.get("error");
    const code = url.searchParams.get("code");
    if (error) {
      res.end("Kirjautuminen peruttiin tai epaonnistui. Voit sulkea taman valilehden.");
      server.close();
      reject(new Error("OAuth error: " + error));
      return;
    }
    if (!code) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.end("Kirjautuminen onnistui! Voit sulkea taman valilehden ja palata terminaaliin.");
    server.close();

    const redirectUri = `http://127.0.0.1:${port}`;
    const tokenRes = await fetch(creds.token_uri, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: creds.client_id,
        client_secret: creds.client_secret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
    if (!tokenRes.ok) throw new Error(`Token-vaihto epaonnistui: ${tokenRes.status} ${await tokenRes.text()}`);
    const json = await tokenRes.json();
    resolve({
      access_token: json.access_token,
      refresh_token: json.refresh_token,
      expiry_date: Date.now() + json.expires_in * 1000,
    });
  } catch (err) {
    reject(err);
  }
}

async function refreshAccessToken(creds, refreshToken) {
  const res = await fetch(creds.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: creds.client_id,
      client_secret: creds.client_secret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Kirjautumisen uusiminen epaonnistui: ${res.status} ${await res.text()}`);
  const json = await res.json();
  return { access_token: json.access_token, expiry_date: Date.now() + json.expires_in * 1000 };
}

async function getAccessToken(creds) {
  let token = loadJson(TOKEN_PATH, null);
  if (token && token.access_token && token.expiry_date > Date.now() + 60_000) {
    return token.access_token;
  }
  if (token && token.refresh_token) {
    try {
      const refreshed = await refreshAccessToken(creds, token.refresh_token);
      token = { ...token, ...refreshed };
      saveJson(TOKEN_PATH, token);
      return token.access_token;
    } catch (err) {
      console.log(`(${err.message} -- kirjaudutaan uudelleen selaimen kautta)`);
    }
  }
  token = await loginWithBrowser(creds);
  saveJson(TOKEN_PATH, token);
  return token.access_token;
}

// --- Google API -kutsut ---

async function apiRequest(accessToken, method, url, body) {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${method} ${url} -> ${res.status}: ${text}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function findOrCreateTaskList(accessToken, name, dryRun) {
  const list = await apiRequest(accessToken, "GET", `${TASKS_API}/users/@me/lists`);
  const existing = (list.items || []).find((t) => t.title === name);
  if (existing) return existing.id;
  if (dryRun) return "DRY_RUN_TASKLIST_ID";
  const created = await apiRequest(accessToken, "POST", `${TASKS_API}/users/@me/lists`, { title: name });
  return created.id;
}

async function findOrCreateCalendar(accessToken, name, dryRun) {
  const list = await apiRequest(accessToken, "GET", `${CAL_API}/users/me/calendarList`);
  const existing = (list.items || []).find((c) => c.summary === name);
  if (existing) return existing.id;
  if (dryRun) return "DRY_RUN_CALENDAR_ID";
  const created = await apiRequest(accessToken, "POST", `${CAL_API}/calendars`, { summary: name });
  return created.id;
}

async function upsertTask(accessToken, tasklistId, existingId, body) {
  if (existingId) return apiRequest(accessToken, "PATCH", `${TASKS_API}/lists/${tasklistId}/tasks/${existingId}`, body);
  return apiRequest(accessToken, "POST", `${TASKS_API}/lists/${tasklistId}/tasks`, body);
}

async function upsertEvent(accessToken, calendarId, existingId, body) {
  if (existingId) return apiRequest(accessToken, "PUT", `${CAL_API}/calendars/${calendarId}/events/${existingId}`, body);
  return apiRequest(accessToken, "POST", `${CAL_API}/calendars/${calendarId}/events`, body);
}

// Google-kirjautumistiedot joko .env:ista (GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET)
// tai credentials.json:ista -- kumpi tahansa kelpaa, .env on ensisijainen.
function loadGoogleCredentials() {
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    return {
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      auth_uri: process.env.GOOGLE_AUTH_URI || "https://accounts.google.com/o/oauth2/auth",
      token_uri: process.env.GOOGLE_TOKEN_URI || "https://oauth2.googleapis.com/token",
    };
  }
  const creds = loadJson(CREDENTIALS_PATH, null);
  if (creds) return creds.installed || creds.web || null;
  return null;
}

// --- Paaohjelma ---

// overrideOpts: kun sync_to_google.js:ta kutsutaan ohjelmallisesti (esim.
// server.js:n /api/sync-google-reitilta), argumentit annetaan tassa
// sen sijaan etta luetaan process.argv:sta -- server.js:n OMAT
// komentorivilipuf (esim. --port) eivat silloin voi vahingossa sekoittua
// synkan asetuksiin. CLI-kaytossa (node sync_to_google.js ...) overrideOpts
// on undefined ja process.argv luetaan normaalisti.
async function main(overrideOpts) {
  const opts = overrideOpts ? Object.assign(parseArgs([]), overrideOpts) : parseArgs(process.argv.slice(2));

  if (opts.logout) {
    if (fs.existsSync(TOKEN_PATH)) fs.unlinkSync(TOKEN_PATH);
    console.log("Kirjauduttu ulos (token.json poistettu).");
    return { loggedOut: true };
  }

  const oauth = loadGoogleCredentials();
  if (!oauth) {
    // Heitetaan virhe (ei process.exit) jotta kutsuja (esim. server.js, joka
    // pyorii pitkaan taustalla) voi napata sen eika koko palvelin kaadu --
    // CLI-kaytossa alla oleva require.main-haara nappaa taman ja tekee
    // process.exit(1):n aivan kuten ennenkin.
    throw new Error(
      'Google-kirjautumistietoja ei loydy. Lisaa .env-tiedostoon GOOGLE_CLIENT_ID ja ' +
        "GOOGLE_CLIENT_SECRET (ks. .env.example), tai lataa credentials.json Google Cloud " +
        'Consolesta. Katso README.md:n osio "Google-kalenterisynkka".'
    );
  }

  let courses = loadJson(DATA_JSON_PATH, []);
  if (opts.course) courses = courses.filter((c) => c.id === opts.course);

  const state = loadJson(STATE_PATH, {});
  const accessToken = await getAccessToken(oauth);

  const neededTasklist = courses.some((c) => (c.deadlines || []).some(isTaskType));
  // Calendaria tarvitaan aina nykyaan: JOKAINEN deadline saa "paivaa ennen"
  // -muistutustapahtuman Calendariin tyypista riippumatta (ks. alla).
  const tasklistId = neededTasklist ? await findOrCreateTaskList(accessToken, opts.tasklistName, opts.dryRun) : null;
  const calendarId = await findOrCreateCalendar(accessToken, opts.calendarName, opts.dryRun);

  let created = 0;
  let updated = 0;
  let skipped = 0;

  // Yhden rivin (varsinainen deadline TAI jompikumpi muistutus) synkkaus:
  // katsoo onko jo ajan tasalla (hash), luo/paivittaa tarvittaessa, ja
  // kasvattaa created/updated/skipped-laskureita. dry-run -tilassa ei tee
  // mitaan pysyvaa, vain tulostaa mita tehtaisiin.
  async function syncEntry(key, kind, body, label) {
    const hash = shortHash(body);
    const prev = state[key];

    if (prev && prev.hash === hash) {
      skipped++;
      return;
    }
    if (opts.dryRun) {
      console.log(`${prev ? "PAIVITTAISI" : "LOISI"} (${kind}): ${label}`);
      return;
    }

    let result;
    if (kind === "task") {
      result = await upsertTask(accessToken, tasklistId, prev && prev.id, body);
      state[key] = { kind, id: result.id, listId: tasklistId, hash };
    } else {
      result = await upsertEvent(accessToken, calendarId, prev && prev.id, body);
      state[key] = { kind, id: result.id, listId: calendarId, hash };
    }

    if (prev) {
      updated++;
      console.log(`Paivitetty: ${label}`);
    } else {
      created++;
      console.log(`Luotu: ${label}`);
    }
  }

  for (const course of courses) {
    for (const deadline of course.deadlines || []) {
      const key = deadlineKey(course, deadline);
      const kind = isTaskType(deadline) ? "task" : "event";
      const body = kind === "task" ? buildTaskBody(course, deadline) : buildEventBody(course, deadline);
      const label = `[${course.id}] ${deadline.date} ${deadline.title}`;
      await syncEntry(key, kind, body, label);

      // "Paivaa ennen" -muistutus Calendariin JOKAISELLE deadlinelle (myos
      // Tasks-tyyppisille) - ei jos muistutushetki on jo menneisyydessa.
      const reminderDate = addDays(deadline.date, -REMINDER_DAYS_BEFORE);
      if (!isInPast(reminderDate, REMINDER_TIME_START)) {
        const reminderBody = buildDayBeforeReminderBody(course, deadline);
        await syncEntry(`${key}::reminder1d`, "event", reminderBody, `Muistutus (1pv ennen): ${label}`);
      }

      // EXAM-ajanvarausmuistutus: vain tentti-tyyppisille joilla tiedetaan
      // examWindowEnd, ja vain jos muistutushetki ei ole jo menneisyydessa.
      if (deadline.type === "exam" && deadline.examWindowEnd) {
        const examReminderDate = addDays(deadline.examWindowEnd, -EXAM_BOOKING_HORIZON_DAYS);
        if (!isInPast(examReminderDate, EXAM_REMINDER_TIME_START)) {
          const examBody = buildExamBookingReminderBody(course, deadline, examReminderDate);
          await syncEntry(`${key}::exambooking`, "event", examBody, `EXAM-varausmuistutus: ${label}`);
        }
      }
    }
  }

  if (!opts.dryRun) {
    saveJson(STATE_PATH, state);
    console.log(`\nValmis. Luotu ${created}, paivitetty ${updated}, ennallaan ${skipped}.`);
  } else {
    console.log("\n--dry-run: mitaan ei muutettu Googlessa.");
  }

  return { created, updated, skipped, totalCourses: courses.length, dryRun: !!opts.dryRun };
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Odottamaton virhe:", err);
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
  deadlineKey,
  isTaskType,
  addDays,
  isInPast,
  buildTaskBody,
  buildEventBody,
  buildDayBeforeReminderBody,
  buildExamBookingReminderBody,
  shortHash,
  findOrCreateTaskList,
  findOrCreateCalendar,
  upsertTask,
  upsertEvent,
  apiRequest,
  loadGoogleCredentials,
  main,
};
