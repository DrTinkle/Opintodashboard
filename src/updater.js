// updater.js
//
// Päivitysten tarkistus ja asennus GitHubista.
//
// - Tarkistus: verrataan oman package.json:n versiota GitHubin main-haaran
//   package.json:n versioon (raw.githubusercontent.com). Käyttöliittymä
//   tarkistaa aina sivun latautuessa (?force=1, ohittaa välimuistin).
//   Tulos pidetään muistissa 5 minuuttia muita kyselyjä varten (esim.
//   päivityksen jälkeinen uudelleenkäynnistyksen odotus kyselee sekunnin
//   välein), jottei GitHubia kuormiteta turhaan.
// - Asennus:
//     * git-kloonissa `git pull --ff-only` (ei yhdistä paikallisia
//       muutoksia väkisin, vaan kertoo niistä virheenä)
//     * zip-tiedostona ladatussa kansiossa ladataan main-haaran tar.gz
//       GitHubista ja kirjoitetaan sen tiedostot kansion päälle. Omat
//       tiedot (data/, .env, debug/, public/data.js) ohitetaan, ja vain
//       muuttuneet tiedostot kirjoitetaan.
//   Lopuksi ajetaan uusi src/setup.js (puuttuvat tiedostot, data.js).
//
// Julkaisussa pitää nostaa package.json:n versiota, muuten muut eivät saa
// päivitysilmoitusta (ks. AGENTS.md).

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { spawnSync } = require("child_process");
const { ROOT } = require("./paths.js");

const REPO = "DrTinkle/Opintodashboard";
const BRANCH = "main";
const REPO_URL = `https://github.com/${REPO}`;
const REMOTE_PACKAGE_URL = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/package.json`;
const ARCHIVE_URL = `https://codeload.github.com/${REPO}/tar.gz/refs/heads/${BRANCH}`;
const CHECK_CACHE_MS = 5 * 60 * 1000;
const TIMEOUT_MS = 10000;
const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;

function currentVersion() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
}

// "1.10.0" > "1.9.3". Puuttuvat osat tulkitaan nolliksi.
function compareVersions(a, b) {
  const pa = String(a || "0").split(".").map((x) => parseInt(x, 10) || 0);
  const pb = String(b || "0").split(".").map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

function updateMethod() {
  if (!fs.existsSync(path.join(ROOT, ".git"))) return "archive";
  const r = spawnSync("git", ["--version"], { cwd: ROOT, windowsHide: true });
  return r.status === 0 ? "git" : "archive";
}

let cache = null; // { at, latest }

// Palauttaa { current, latest, updateAvailable, method, repoUrl, error? }.
// Verkkovirhe ei ole poikkeus: silloin updateAvailable on false ja error kertoo syyn.
async function checkForUpdate({ force = false } = {}) {
  const current = currentVersion();
  const base = { current, method: updateMethod(), repoUrl: REPO_URL };
  if (force || !cache || Date.now() - cache.at > CHECK_CACHE_MS) {
    try {
      const res = await fetch(REMOTE_PACKAGE_URL, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw new Error("GitHub vastasi HTTP " + res.status);
      const latest = JSON.parse(await res.text()).version;
      if (!latest) throw new Error("versiotietoa ei löytynyt");
      cache = { at: Date.now(), latest };
    } catch (err) {
      return { ...base, latest: null, updateAvailable: false, error: "Päivitysten tarkistus epäonnistui: " + err.message };
    }
  }
  return { ...base, latest: cache.latest, updateAvailable: compareVersions(cache.latest, current) > 0 };
}

// --- tar.gz-purku ilman kirjastoja ---

function parsePax(buf) {
  const out = {};
  let i = 0;
  while (i < buf.length) {
    const sp = buf.indexOf(0x20, i);
    if (sp === -1) break;
    const len = parseInt(buf.subarray(i, sp).toString("ascii"), 10);
    if (!len) break;
    const rec = buf.subarray(sp + 1, i + len - 1).toString("utf8");
    const eq = rec.indexOf("=");
    if (eq > 0) out[rec.slice(0, eq)] = rec.slice(eq + 1);
    i += len;
  }
  return out;
}

function readTar(buf) {
  const entries = [];
  let off = 0;
  let nextName = null;
  const str = (h, a, b) => {
    const s = h.subarray(a, b);
    const z = s.indexOf(0);
    return (z === -1 ? s : s.subarray(0, z)).toString("utf8");
  };
  while (off + 512 <= buf.length) {
    const h = buf.subarray(off, off + 512);
    if (h.every((b) => b === 0)) break;
    const size = parseInt(str(h, 124, 136).trim() || "0", 8);
    const type = String.fromCharCode(h[156] || 0x30);
    const magic = str(h, 257, 263);
    let name = str(h, 0, 100);
    const prefix = magic.startsWith("ustar") ? str(h, 345, 500) : "";
    if (prefix) name = prefix + "/" + name;
    const data = buf.subarray(off + 512, off + 512 + size);
    off += 512 + Math.ceil(size / 512) * 512;
    if (type === "x") {
      nextName = parsePax(data).path || nextName;
      continue;
    }
    if (type === "g") continue;
    if (type === "L") {
      nextName = str(data, 0, data.length);
      continue;
    }
    entries.push({ name: nextName || name, type: type === "\0" ? "0" : type, data });
    nextName = null;
  }
  return entries;
}

// Päivitys ei koske omiin tietoihin.
function isProtected(rel) {
  if (rel === "data/data.example.json") return false;
  if (rel.startsWith("data/") || rel.startsWith("debug/") || rel.startsWith(".git/")) return true;
  if (rel === "public/data.js") return true;
  if (rel === ".env" || (rel.startsWith(".env.") && rel !== ".env.example")) return true;
  return false;
}

function writeFileAtomic(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = filePath + ".tmp-update";
  fs.writeFileSync(tmp, data);
  try {
    fs.renameSync(tmp, filePath);
  } catch (err) {
    fs.writeFileSync(filePath, data);
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ei haittaa */
    }
  }
}

async function updateFromArchive() {
  const res = await fetch(ARCHIVE_URL, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error("Lataus GitHubista epäonnistui: HTTP " + res.status);
  const gz = Buffer.from(await res.arrayBuffer());
  if (gz.length > MAX_ARCHIVE_BYTES) throw new Error("Ladattu paketti oli odottamattoman suuri.");
  const entries = readTar(zlib.gunzipSync(gz));
  const files = entries.filter((e) => e.type === "0");
  if (!files.length || !files.some((e) => /(^|\/)package\.json$/.test(e.name))) {
    throw new Error("Ladattu paketti ei näyttänyt Opintodashboardilta.");
  }
  let written = 0;
  for (const e of files) {
    // GitHubin paketissa kaikki on yhden juurikansion alla (Opintodashboard-main/).
    const rel = e.name.split("/").slice(1).join("/");
    if (!rel || isProtected(rel)) continue;
    const target = path.resolve(ROOT, rel);
    if (target !== ROOT && !target.startsWith(ROOT + path.sep)) continue; // ei polkuja kansion ulkopuolelle
    let same = false;
    try {
      same = fs.readFileSync(target).equals(e.data);
    } catch {
      same = false;
    }
    if (same) continue;
    writeFileAtomic(target, e.data);
    written++;
  }
  return { method: "archive", filesWritten: written };
}

function updateWithGit() {
  const r = spawnSync("git", ["pull", "--ff-only"], { cwd: ROOT, windowsHide: true, encoding: "utf8" });
  if (r.status !== 0) {
    const msg = ((r.stderr || "") + (r.stdout || "")).trim().split("\n").slice(-3).join(" ");
    throw new Error(
      "git pull epäonnistui" + (msg ? ": " + msg : "") +
        ". Jos olet muokannut tiedostoja itse, päivitä käsin (git status)."
    );
  }
  return { method: "git", output: (r.stdout || "").trim() };
}

async function runUpdate() {
  const from = currentVersion();
  const result = updateMethod() === "git" ? updateWithGit() : await updateFromArchive();
  // Uuden version setup: puuttuvat omat tiedostot ja data.js.
  spawnSync(process.execPath, [path.join(ROOT, "src", "setup.js")], { cwd: ROOT, windowsHide: true, stdio: "ignore" });
  cache = null;
  return { ...result, from, to: currentVersion() };
}

module.exports = { checkForUpdate, runUpdate, compareVersions, readTar, isProtected, currentVersion };
