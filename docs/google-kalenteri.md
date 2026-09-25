# Google-kalenterisynkka

"Vie Googleen" -nappi vie deadlinesi Googleen, jotta ne näkyvät myös
puhelimessa:

- **Palautettavat tehtävät** (`task`) menevät **Google Tasksiin**, listalle
  "Koulu - Deadlinet".
- **Tentit, labrat ja muut** (`exam`, `lab`, `event`) menevät
  **Google-kalenteriin** koko päivän tapahtumina, kalenteriin "Koulu".
- Jokainen deadline saa lisäksi **muistutuksen edellisenä päivänä klo 18**.
- EXAM-tenteille, joilla on tiedossa varausikkuna, tulee muistutus sinä
  päivänä, kun koko ikkuna on varattavissa (EXAM-järjestelmä avaa ajat
  noin 30 vuorokautta etukäteen).

Synkka on toistettava: uusi ajo päivittää olemassa olevat merkinnät eikä
luo kopioita. Jos poistat deadlinen dashboardilta, sen Google-merkintä jää
kuitenkin paikalleen, joten poista se tarvittaessa käsin.

## Kertaluontoinen asetus (noin 10 minuuttia)

Google vaatii, että jokainen käyttäjä luo oman OAuth-asiakkaan. Se on
ilmainen.

1. Avaa https://console.cloud.google.com/ ja luo uusi projekti
   (esim. "opintodashboard").
2. **APIs & Services > Library:** ota käyttöön **Google Tasks API** ja
   **Google Calendar API**.
3. **APIs & Services > OAuth consent screen:**
   - User type: **External**
   - Täytä pakolliset kentät (sovelluksen nimi ja oma sähköposti).
   - Lisää oma Google-tilisi **Test users** -listalle.
4. **APIs & Services > Credentials > Create Credentials > OAuth client ID:**
   - Application type: **Desktop app**
   - Luo, ja kopioi näkyviin tulevat **Client ID** ja **Client Secret**.
5. Avaa dashboardin **Asetukset**-välilehti, liitä arvot
   Google-kalenterisynkan kenttiin ja tallenna.

Vaihtoehtoisesti voit ladata client-tiedoston JSON-muodossa ja tallentaa
sen dashboardin `data/`-kansioon nimellä `credentials.json`.

## Ensimmäinen vienti

Paina yläpalkin **Vie Googleen**. Selain avautuu Googlen
kirjautumiseen:

1. Kirjaudu omalla Google-tililläsi.
2. Google varoittaa, ettei sovellusta ole vahvistettu. Tämä on normaalia,
   koska sovellus on oma testiprojektisi: valitse **Advanced >
   Go to <sovelluksesi nimi> (unsafe)**.
3. Hyväksy oikeudet Tasksiin ja kalenteriin.

Kirjautuminen muistetaan tiedostossa `data/token.json`, joten seuraavilla
kerroilla selainta ei tarvitse avata.

## Komentorivi

Nappi käyttää oletusasetuksia. Komentoriviltä voit rajata vientiä:

```
node src/integrations/sync_to_google.js --dry-run                   # näytä mitä tehtäisiin, älä muuta mitään
node src/integrations/sync_to_google.js --course <kurssin-id>       # vain yksi kurssi (data.json:in id)
node src/integrations/sync_to_google.js --tasklist "Oma lista" --calendar "Oma kalenteri"
node src/integrations/sync_to_google.js --logout                    # unohda kirjautuminen (poistaa token.json:in)
```

## Tiedostot, joita ei koskaan jaeta

`.gitignore` pitää nämä poissa gitistä:

- `data/credentials.json`: oma OAuth-asiakkaasi
- `data/token.json`: kirjautumisesi Googleen
- `data/sync_state.json`: tieto siitä, mikä deadline vastaa mitäkin
  Google-merkintää
