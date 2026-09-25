// estimate_deepseek.js
//
// DeepSeek-API:n avulla arvioidaan uudelle Moodle-tehtavalle karkea
// tuntimaara (estimatedHours) ja viikkotahti (estimatedPace, h/vko) - sama
// skeema jota dashboard jo kayttaa "Aloita viimeistaan" -laskennassa (ks.
// index.html: computeStartByDate/getPlanHoursPace). Kutsutaan VAIN aidosti
// uusille tehtaville sync_moodle.js:sta ja update_from_moodle.js:sta - ei
// joka skannauksella jo tunnetuille tehtaville, jotta API-kutsuja ei
// tuhlata (ks. docs/INDEX.md, osio "DeepSeek-arviot").
//
// Vaatii .env-tiedostoon DEEPSEEK_API_KEY:n (ks. .env.example). Jos avainta
// ei ole, tai kutsu epaonnistuu MILLA TAHANSA tavalla (verkko, aikakatkaisu,
// virheellinen vastaus, jarjeton arvo), palautetaan null eika mitaan
// arvioita lisata - tehtava lisataan silti data.json:iin normaalisti ilman
// estimatedHours/estimatedPace-kenttia (dashboard toimii ilman niitakin,
// aivan kuten ennen tata ominaisuutta). Tama ominaisuus ei koskaan saa
// kaataa itse Moodle-skannausta.

const DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions";
const DEEPSEEK_MODEL = "deepseek-chat";
const REQUEST_TIMEOUT_MS = 20000;

function buildPrompt(course, item) {
  const title = (item && item.title) || "";
  const notes = (item && item.notes) || "";
  return [
    {
      role: "system",
      content:
        "Olet avustaja joka arvioi opiskelijan Moodle-tehtaville realistisen " +
        "tyomaaran. Vastaa AINA ja VAIN JSON-objektilla jossa on tasan kaksi " +
        'kenttaa: {"estimatedHours": <numero>, "estimatedPace": <numero>}. ' +
        "estimatedHours on karkea arvio KOKO tehtavan vaatimasta tyoajasta " +
        "tunteina (esim. 2-40 riippuen tehtavan laajuudesta - lyhyt " +
        "viikkotehtava on usein 2-6h, laajempi projektityo voi olla " +
        "kymmenia tunteja). estimatedPace on jarkeva viikkotahti " +
        "tunteina/viikko jos opiskelija tekisi tehtavaa tasaisesti ennen " +
        "maaraaikaa (esim. 2-8). Ala selita mitaan, ala kirjoita mitaan " +
        "muuta kuin se yksi JSON-objekti.",
    },
    {
      role: "user",
      content:
        `Kurssi: ${(course && course.name) || "?"}\n` +
        `Tehtavan otsikko: ${title}\n` +
        (notes ? `Tehtavan kuvaus:\n${notes}` : "(ei tarkempaa kuvausta saatavilla, arvioi pelkan otsikon perusteella)"),
    },
  ];
}

// Poimii ensimmaisen {...}-lohkon vastauksesta, vaikka malli olisi (ohjeista
// huolimatta) kietonut sen esim. ```json-koodilohkoon.
function extractJsonObject(text) {
  if (!text) return null;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch (e) {
    return null;
  }
}

// Hylkaa epakelvot/jarjettomat arvot (ei-numero, negatiivinen, nolla,
// aarettoman suuri) ja rajaa jarkevalle valille. Pyoristetaan 0.5:n
// tarkkuuteen, koska dashboard nayttaa nama "h" / "h/vko" -kenttina.
function sanitizeNumber(n, min, max) {
  const num = Number(n);
  if (!Number.isFinite(num) || num <= 0) return null;
  const rounded = Math.round(num * 2) / 2;
  return Math.min(max, Math.max(min, rounded));
}

async function estimateWithDeepSeek(course, item) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(DEEPSEEK_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages: buildPrompt(course, item),
        response_format: { type: "json_object" },
        temperature: 0.3,
        max_tokens: 100,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.log(`  (DeepSeek-arvio epaonnistui: HTTP ${res.status} ${text.slice(0, 200)} - jatketaan ilman arviota)`);
      return null;
    }

    const data = await res.json();
    const content =
      data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    const parsed = extractJsonObject(content);
    if (!parsed) {
      console.log("  (DeepSeek-arvio: vastausta ei saatu jasennettya JSON:iksi - jatketaan ilman arviota)");
      return null;
    }

    const estimatedHours = sanitizeNumber(parsed.estimatedHours, 0.5, 200);
    const estimatedPace = sanitizeNumber(parsed.estimatedPace, 0.5, 40);
    if (estimatedHours == null || estimatedPace == null) {
      console.log("  (DeepSeek-arvio: saadut luvut eivat kelvanneet - jatketaan ilman arviota)");
      return null;
    }

    return { estimatedHours, estimatedPace };
  } catch (err) {
    console.log(`  (DeepSeek-arvio epaonnistui: ${err.message} - jatketaan ilman arviota)`);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { estimateWithDeepSeek, buildPrompt, extractJsonObject, sanitizeNumber };
