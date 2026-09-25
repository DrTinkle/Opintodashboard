#!/usr/bin/env node
// refresh_moodle_session.js
//
// Kirjautuu Moodleen automaattisesti SAMK:in Shibboleth-kirjautumisen (SSO)
// lapi kayttajatunnuksella ja salasanalla, ja kirjoittaa tuoreen
// MoodleSession-evasteen .env-tiedostoon (MOODLE_SESSION). Tarkoitus on
// etta MoodleSession-evastetta ei enaa tarvitse hakea kasin DevToolsista.
//
// Vaatii .env-tiedostoon (ks. .env.example):
//   MOODLE_USERNAME=<samk-kayttajatunnus>
//   MOODLE_PASSWORD=<samk-salasana>
//
// HUOM tietoturvasta: nama tallennetaan .env-tiedostoon selkokielisena.
// .env on jo .gitignoressa, mutta suojaa silti koko kansio/kone normaalisti
// -- Haka-tunnus paasee periaatteessa useampaan palveluun kuin pelkka
// Moodle-eväste. Jos et halua tata riskia, käytä sen sijaan pelkkää
// MOODLE_SESSION-evastetta (ks. README) ja hae se kasin DevToolsista.
//
// Kayttö:
//   node src/moodle/refresh_moodle_session.js              # kirjautuu, paivittaa .env:in
//   node src/moodle/refresh_moodle_session.js --dry-run    # kirjautuu, nayttaa tuloksen, ei kirjoita .env:iin
//   node src/moodle/refresh_moodle_session.js --debug      # tulostaa hyppy hypylta mihin URL:eihin mentiin (ei salasanaa, ei sivujen sisaltoa)
//
// Tekninen tausta (Shibboleth SSO, ei koodattu kiinni tarkkoihin URL:eihin
// paitsi ensimmaiseen laukaisuun, jotta pienet muutokset IdP:ssa eivat
// riko tata):
//   1. GET login/index.php -> Moodle ohjaa suoraan idp.samk.fi:hin, joka
//      nayttaa kirjautumislomakkeen (kentat j_username, j_password,
//      csrf_token).
//   2. POST käyttäjätunnus+salasana samalle lomakkeelle.
//   3. IdP palauttaa "autopost"-valilomakkeen (SAMLResponse+RelayState),
//      joka normaalisti laheteta selaimen JS:lla automaattisesti eteenpain
//      Moodlen vastaanottopaatepisteeseen. Tama skripti seuraa mita tahansa
//      tallaista lomaketta yleisesti (ei tiedä etukateen tarkkaa
//      osoitetta), kunnes paadytaan sivulle jolla ei ole enaa lomaketta.
//   4. Jokaisen hypyn Set-Cookie-otsikot taltioidaan per verkkotunnus, ja
//      lopuksi moodle5.samk.fi:n MoodleSession-arvo poimitaan talteen.
//
// Jos SAMK muuttaa kirjautumissivuaan isommin (esim. lisaa 2FA-vaiheen),
// tama skripti todennakoisesti kaatuu selkeaan virheeseen jostain
// valivaiheesta -- aja --debug ja katso mihin URL:iin/vaiheeseen se jai
// jumiin.

const fs = require("fs");
const path = require("path");
require("../load_env.js").loadEnvFile();
const {
  decodeEntities,
  looksLikeLoginPageLoose: looksLikeLoginPage,
  BASE_URL,
} = require("./scrape_course_content.js");

const { ENV_PATH } = require("../paths.js");
const { writeTextAtomic } = require("../json_file.js");
const LOGIN_TRIGGER_URL = `${BASE_URL}/login/index.php`;
const MAX_RELAY_HOPS = 5;

function parseArgs(argv) {
  const out = { debug: false, dryRun: false };
  for (const a of argv) {
    if (a === "--debug") out.debug = true;
    else if (a === "--dry-run") out.dryRun = true;
  }
  return out;
}

// --- Pieni per-verkkotunnus-evastepurkki ---

function cookieOrigin(url) {
  return new URL(url).origin;
}

function updateCookies(jar, url, setCookieHeaders) {
  if (!setCookieHeaders || !setCookieHeaders.length) return;
  const origin = cookieOrigin(url);
  if (!jar[origin]) jar[origin] = {};
  setCookieHeaders.forEach((sc) => {
    const firstPart = sc.split(";")[0];
    const eq = firstPart.indexOf("=");
    if (eq === -1) return;
    const name = firstPart.slice(0, eq).trim();
    const value = firstPart.slice(eq + 1).trim();
    jar[origin][name] = value;
  });
}

function cookieHeader(jar, url) {
  const origin = cookieOrigin(url);
  const cookies = jar[origin];
  if (!cookies) return "";
  return Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

function getSetCookies(res) {
  if (typeof res.headers.getSetCookie === "function") return res.headers.getSetCookie();
  const single = res.headers.get("set-cookie");
  return single ? [single] : [];
}

// --- HTML-lomakkeiden poiminta (geneerinen, ei tunne tiettyja kenttanimia) ---

function extractFormFields(formBodyHtml) {
  const fields = {};
  const inputRe = /<input\b([^>]*)>/gi;
  let m;
  while ((m = inputRe.exec(formBodyHtml))) {
    const attrs = m[1];
    const nameMatch = attrs.match(/\bname=["']([^"']+)["']/i);
    if (!nameMatch) continue;
    const typeMatch = attrs.match(/\btype=["']([^"']+)["']/i);
    const valueMatch = attrs.match(/\bvalue=["']([^"']*)["']/i);
    const type = (typeMatch ? typeMatch[1] : "text").toLowerCase();
    if (type === "checkbox" || type === "radio") {
      if (!/\bchecked\b/i.test(attrs)) continue;
    }
    fields[nameMatch[1]] = valueMatch ? decodeEntities(valueMatch[1]) : "";
  }

  // Osa Shibboleth-lomakkeista kayttaa <button name="_eventId_proceed"
  // value="proceed">-tyyppista lahetysnappia <input type="submit"> sijaan.
  // Ilman tata webflow ei tieda mita tapahtumaa (event) kayttaja valitsi,
  // ja lomake vain palautuu takaisin itseensa "kirjautuminen epaonnistui"
  // -oloisena vaikka tunnukset olisivat oikein.
  const buttonRe = /<button\b([^>]*)>/gi;
  while ((m = buttonRe.exec(formBodyHtml))) {
    const attrs = m[1];
    const nameMatch = attrs.match(/\bname=["']([^"']+)["']/i);
    if (!nameMatch) continue;
    const typeMatch = attrs.match(/\btype=["']([^"']+)["']/i);
    const type = (typeMatch ? typeMatch[1] : "submit").toLowerCase();
    if (type === "button" || type === "reset") continue;
    if (nameMatch[1] in fields) continue;
    const valueMatch = attrs.match(/\bvalue=["']([^"']*)["']/i);
    fields[nameMatch[1]] = valueMatch ? decodeEntities(valueMatch[1]) : "";
  }

  return fields;
}

function extractForms(html) {
  const forms = [];
  const formRe = /<form\b([^>]*)>([\s\S]*?)<\/form>/gi;
  let m;
  while ((m = formRe.exec(html))) {
    const attrs = m[1];
    const body = m[2];
    const actionMatch = attrs.match(/\baction=["']([^"']*)["']/i);
    const methodMatch = attrs.match(/\bmethod=["']([^"']*)["']/i);
    forms.push({
      action: actionMatch ? decodeEntities(actionMatch[1]) : "",
      method: (methodMatch ? methodMatch[1] : "GET").toUpperCase(),
      fields: extractFormFields(body),
    });
  }
  return forms;
}

// --- HTTP-pyynto joka seuraa uudelleenohjaukset kasin (jotta evasteet saadaan talteen joka hypylta) ---

async function request(jar, url, opts = {}, redirectsLeft = 10) {
  const headers = Object.assign({}, opts.headers);
  const cookies = cookieHeader(jar, url);
  if (cookies) headers["Cookie"] = cookies;

  const res = await fetch(url, {
    method: opts.method || "GET",
    headers,
    body: opts.body,
    redirect: "manual",
  });
  updateCookies(jar, url, getSetCookies(res));

  const location = res.headers.get("location");
  if (res.status >= 300 && res.status < 400 && location && redirectsLeft > 0) {
    const nextUrl = new URL(location, url).toString();
    return request(jar, nextUrl, { method: "GET" }, redirectsLeft - 1);
  }

  const body = await res.text();
  return { status: res.status, url, body };
}

// --- Paalogiikka ---

async function fetchFreshSessionCookie(username, password) {
  const jar = {};
  const trace = [];

  let res = await request(jar, LOGIN_TRIGGER_URL);
  trace.push({ step: "trigger", url: res.url, status: res.status });

  // Ennen varsinaista kirjautumislomaketta Shibbolethin IdP nayttaa usein
  // valivaiheen "Loading Session Information" -sivun, joka selaimessa
  // submittaa itsensa automaattisesti JS:lla (tarkistaa tukeeko selain
  // localStoragea). Koska taalla ei aja JS:aa, se pitaa simuloida: lomake
  // POST:ataan takaisin samoihin (oletusarvoisiin) kenttiin, mika vastaa
  // "selain ei tue JS:aa, paina Continue" -polkua. Toistetaan tama kunnes
  // vastaan tulee oikea j_username-lomake, tai luovutaan hyppyrajan jalkeen.
  let forms = extractForms(res.body);
  let loginForm = forms.find((f) => Object.prototype.hasOwnProperty.call(f.fields, "j_username"));
  let preHops = 0;
  while (!loginForm && preHops < MAX_RELAY_HOPS) {
    const interstitial = forms.find(
      (f) => f.action && Object.prototype.hasOwnProperty.call(f.fields, "_eventId_proceed")
    );
    if (!interstitial) break;
    const stepUrl = new URL(interstitial.action, res.url).toString();
    const stepBody = new URLSearchParams(interstitial.fields);
    res = await request(jar, stepUrl, {
      method: "POST",
      body: stepBody,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    trace.push({ step: `pre-login-${preHops}`, url: res.url, status: res.status });
    forms = extractForms(res.body);
    loginForm = forms.find((f) => Object.prototype.hasOwnProperty.call(f.fields, "j_username"));
    preHops++;
  }
  if (!loginForm) {
    const err = new Error(
      "Kirjautumislomaketta ei löytynyt (j_username-kenttää ei näkynyt haetulla sivulla). " +
        "SAMK on voinut muuttaa kirjautumissivuaan -- aja --debug ja katso mihin jäätiin."
    );
    err.trace = trace;
    throw err;
  }

  const loginActionUrl = new URL(loginForm.action || res.url, res.url).toString();
  const loginBody = new URLSearchParams(
    Object.assign({}, loginForm.fields, { j_username: username, j_password: password })
  );
  trace.push({ step: "login-form-fields", fieldNames: Object.keys(loginForm.fields) });
  res = await request(jar, loginActionUrl, {
    method: "POST",
    body: loginBody,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  trace.push({ step: "login-post", url: res.url, status: res.status });

  if (/name=["']j_username["']/.test(res.body)) {
    // Yritetaan poimia nakyva virheteksti lomakkeelta (esim. "vaara
    // kayttajatunnus/salasana"), jotta erotamme sen muista syista.
    const errMatch =
      res.body.match(/class=["'][^"']*form-error[^"']*["'][^>]*>([\s\S]*?)<\/(?:p|div|span)>/i) ||
      res.body.match(/<section[^>]*class=["'][^"']*alert[^"']*["'][^>]*>([\s\S]*?)<\/section>/i);
    const visibleError = errMatch ? errMatch[1].replace(/<[^>]+>/g, "").trim() : null;
    trace.push({ step: "login-post-error-text", text: visibleError });
    const err = new Error(
      "Kirjautuminen ei mennyt läpi -- palattiin takaisin kirjautumislomakkeelle. " +
        (visibleError ? `Sivulla luki: "${visibleError}". ` : "") +
        "Tarkista MOODLE_USERNAME ja MOODLE_PASSWORD .env-tiedostosta."
    );
    err.trace = trace;
    throw err;
  }

  // Geneerinen SAML-relay-lomakkeen (esim. SAMLResponse-autopost) seuraaminen.
  // Ei tiedeta etukateen tarkkaa kohdeosoitetta, seurataan mita tahansa
  // lomaketta kunnes paadytaan sivulle jolla ei enaa ole yhtaan lomaketta --
  // TAI kunnes ollaan jo paasty takaisin Moodleen kirjautuneena, jolloin
  // lopetetaan heti eika seurata enaa mahdollisia muita lomakkeita (esim.
  // Moodlen etusivun hakukenttaa tms.) turhaan pidemmalle.
  const moodleOrigin = new URL(BASE_URL).origin;
  let hops = 0;
  while (hops < MAX_RELAY_HOPS) {
    if (res.url.startsWith(moodleOrigin) && !looksLikeLoginPage(res.body)) break;
    forms = extractForms(res.body);
    if (forms.length === 0 || !forms[0].action) break;
    const relayForm = forms[0];
    const relayUrl = new URL(relayForm.action, res.url).toString();
    const relayBody = new URLSearchParams(relayForm.fields);
    res = await request(jar, relayUrl, {
      method: "POST",
      body: relayBody,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    trace.push({ step: `relay-${hops}`, url: res.url, status: res.status });
    hops++;
  }

  const sessionValue = jar[moodleOrigin] && jar[moodleOrigin]["MoodleSession"];

  // Varmistuspyynto: haetaan viela kerran login-sivu tuoreella evasteella ja
  // tarkistetaan ettei se nayta enaa kirjautumissivulta.
  let verified = false;
  if (sessionValue) {
    const verifyRes = await request(jar, LOGIN_TRIGGER_URL);
    trace.push({ step: "verify", url: verifyRes.url, status: verifyRes.status });
    verified = !looksLikeLoginPage(verifyRes.body);
  }

  return { sessionValue, verified, trace };
}

// Nopea tarkistus onko annettu MoodleSession-arvo yha voimassa (ei aja koko
// kirjautumista, vain yksi GET pyynto). Kaytetaan muista skripteista ennen
// kuin lahdetaan tekemaan oikeaa tyota.
async function isSessionValid(sessionValue) {
  if (!sessionValue) return false;
  const res = await fetch(LOGIN_TRIGGER_URL, {
    redirect: "manual",
    headers: { Cookie: `MoodleSession=${sessionValue}` },
  });
  if (res.status >= 300 && res.status < 400) return false;
  const body = await res.text();
  return !looksLikeLoginPage(body);
}

// Varmistaa etta kaytossa on toimiva MoodleSession: tarkistaa annetun arvon,
// ja jos se puuttuu tai on vanhentunut, kirjautuu automaattisesti sisaan
// MOODLE_USERNAME/MOODLE_PASSWORD -ymparistomuuttujilla (jos ne on
// asetettu) ja paivittaa tuoreen arvon .env-tiedostoon. Palauttaa
// { session, refreshed } -- session on null jos mikaan ei toiminut eika
// kirjautumistietoja ollut kaytettavissa.
async function ensureFreshSession(currentSession, opts = {}) {
  if (await isSessionValid(currentSession)) {
    return { session: currentSession, refreshed: false };
  }
  const username = process.env.MOODLE_USERNAME;
  const password = process.env.MOODLE_PASSWORD;
  if (!username || !password) {
    return { session: null, refreshed: false };
  }
  if (!opts.quiet) console.log("(MoodleSession puuttuu tai on vanhentunut -- kirjaudutaan automaattisesti sisään...)");
  const result = await fetchFreshSessionCookie(username, password);
  if (!result.sessionValue) {
    return { session: null, refreshed: false };
  }
  if (!opts.skipEnvWrite) upsertEnvValue("MOODLE_SESSION", result.sessionValue);
  if (!opts.quiet) console.log("(uusi MoodleSession haettu automaattisesti)");
  return { session: result.sessionValue, refreshed: true };
}

function upsertEnvValue(key, value) {
  let lines = [];
  try {
    lines = fs.readFileSync(ENV_PATH, "utf8").split(/\r?\n/);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  const re = new RegExp(`^${key}=`);
  let found = false;
  const updated = lines.map((line) => {
    if (re.test(line)) {
      found = true;
      return `${key}=${value}`;
    }
    return line;
  });
  if (!found) updated.push(`${key}=${value}`);
  while (updated.length && updated[updated.length - 1] === "") updated.pop();
  writeTextAtomic(ENV_PATH, updated.join("\n") + "\n");
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const username = process.env.MOODLE_USERNAME;
  const password = process.env.MOODLE_PASSWORD;
  if (!username || !password) {
    console.error(
      "MOODLE_USERNAME ja MOODLE_PASSWORD pitää olla asetettuna .env-tiedostossa (ks. .env.example)."
    );
    process.exit(1);
  }

  console.log("Kirjaudutaan Moodleen SAMK:in kirjautumisen kautta...");
  let result;
  try {
    result = await fetchFreshSessionCookie(username, password);
  } catch (err) {
    console.error("Kirjautuminen epäonnistui: " + err.message);
    if (opts.debug && err.trace) console.error(JSON.stringify(err.trace, null, 2));
    process.exit(1);
  }

  if (opts.debug) console.log(JSON.stringify(result.trace, null, 2));

  if (!result.sessionValue) {
    console.error(
      "Kirjautuminen näytti menevän läpi, mutta MoodleSession-evästettä ei löytynyt lopuksi. " +
        "Aja --debug ja katso mihin jäätiin."
    );
    process.exit(1);
  }

  if (!result.verified) {
    console.error(
      "Varoitus: sain MoodleSession-arvon, mutta varmistuspyyntö näytti silti kirjautumissivulta. " +
        "Arvo saatetaan silti kirjoittaa, mutta tarkista toimiiko se oikeasti."
    );
  }

  console.log("Uusi MoodleSession haettu" + (result.verified ? " ja vahvistettu toimivaksi." : "."));

  if (opts.dryRun) {
    console.log("--dry-run: ei kirjoitettu .env-tiedostoon.");
  } else {
    upsertEnvValue("MOODLE_SESSION", result.sessionValue);
    console.log("Kirjoitettu .env-tiedostoon (MOODLE_SESSION).");
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Odottamaton virhe:", err);
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
  cookieOrigin,
  updateCookies,
  cookieHeader,
  extractFormFields,
  extractForms,
  request,
  fetchFreshSessionCookie,
  isSessionValid,
  ensureFreshSession,
  upsertEnvValue,
};
