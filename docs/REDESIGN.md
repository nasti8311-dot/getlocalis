# FiiViu Redesign v2

## Phase 1 — Analyse und Baseline

**Status:** Analyse abgeschlossen; noch keine Produktdatei oder Geschäftslogik geändert.  
**Arbeitsbranch:** `redesign/fiiviu-v2`  
**Ausgangsbasis:** `main` bei Commit `213c8169b44cb055e5f7821ce829f0100f9471cd`.

### 1. Projektstruktur und Technik

- Das Repository enthält eine überwiegend statische Website aus eigenständigen HTML-Seiten und JavaScript-Modulen.
- Die Startseite `index.html` enthält umfangreiches Inline-CSS, Tailwind CSS wird über `https://cdn.tailwindcss.com` geladen.
- Es gibt keine `package.json`, kein zentrales Komponenten-Framework und keine eigenständige CSS-Build-Pipeline.
- Die Startseite bindet außerdem Flatpickr, Stripe.js und Font Awesome per CDN ein. Diese Integrationen werden in diesem Redesign nicht funktional verändert.
- Aktive Worker-/Backend-Einstiegspunkte und APIs bleiben außerhalb des Designumfangs: insbesondere `secure-entry.js`, `marketplace-entry.js`, `worker-entry.js`, `stripe-webhook.js` und `provider-auth.js`.
- Relevante Seiten: Startseite, Anbieterregistrierung, Provider-Dashboard, Organizer-Dashboard, Partner-/Affiliate-Seiten, Buchungs- und Bestätigungsseiten, Stornoseite sowie die Rechtsseiten unter `legal/`.
- Es existiert kein `README.md` und keine `package.json`; die Projektbefehle müssen daher aus den vorhandenen Workflows abgeleitet werden.

### 2. Vorhandene Sprachen und Übersetzungen

- Die Startseite enthält ein eigenes JavaScript-Übersetzungssystem mit den Sprachcodes **Deutsch (`de`), Englisch (`en`) und Rumänisch (`ro`)**.
- Startseiten-Texte werden über `translations[currentLang]` und `data-i18n`-Attribute gesteuert. Neue sichtbare Startseitentexte müssen in allen drei Sprachen in dieses System aufgenommen werden.
- Die übrigen HTML-Seiten sind derzeit sprachlich uneinheitlich: einige sind Rumänisch, andere Deutsch oder Englisch. Ein gemeinsames Übersetzungssystem ist dort nicht erkennbar.
- In Phase 4 werden deshalb keine Texte pauschal umgeschrieben oder übersetzt. Der Umfang ist dort zunächst visuelle Vereinheitlichung; bestehende Textinhalte, Formularnamen, IDs, Datenattribute und API-Verträge bleiben erhalten.
- Rumänische Texte müssen die korrekten Zeichen `ă â î ș ț` (Komma unter ș/ț) verwenden.

### 3. Styling- und Markenbaseline

- Bestehende Markenfarben in der Startseite: Creme/Sand, Anthrazit und Orange (`#E86F2D`, dunkleres Orange `#C9581D`).
- Der Tailwind-Konfigurationsblock definiert bereits einige `fii`-Farben und einen Inter-Font-Stack, lädt Inter aber nicht selbst.
- Viele Unterseiten besitzen eigene, voneinander abweichende Inline-Styles und teils Arial als Schrift. Es gibt noch kein seitenübergreifendes Designsystem.
- Die Startseite verwendet ein externes Pexels-Bild als Hero- und Social-Media-Bild. Das ist keine lokal verwaltete Asset-Basis und wird im Redesign nicht als automatisch freigegebene Markenressource behandelt.
- Im Repository existieren einzelne Bild-/Icon-Dateien, aber noch kein dokumentiertes Asset-Verzeichnis mit vollständigen Lizenznachweisen.

### 4. Designkonzept und wiedererkennbare Eigenheit

**Richtung:** „FiiViu Moments“ — ein warmer, redaktionell gestalteter Erlebnis-Marktplatz mit klarer Typografie, ruhigen Flächen, dunklem Text und kontrollierten Orange-Akzenten.

**Wiedererkennbare Eigenheit:** eine „Moment-Kachel“ mit einer weichen, asymmetrischen Bildsilhouette und einem kleinen orangefarbenen Moment-Marker. Sie wird als wiederkehrendes Gestaltungsmotiv für Kategorien und Erlebnis-Teaser eingesetzt. Die Form soll FiiViu visuell von einem generischen Kartenraster unterscheiden, ohne Inhalte oder Bedienmuster zu verstecken. Die Kachel bleibt responsiv, zugänglich und verwendet nur echte, bereits vorhandene oder nachweislich lizenzierte Medien.

### 5. Befehle und Baseline-Prüfung

Es existiert kein package-/npm-Skript für Start oder Build.

| Zweck | Vorhandener Befehl / Workflow |
|---|---|
| JavaScript-Syntax | `node --check <datei.js>` (im Workflow für alle JS-Dateien) |
| Regressionstests | `node --test tests/launch-hardening.test.js` |
| Worker-/Wrangler-Buildprüfung | `npx --yes wrangler@4 deploy --dry-run --outdir=.wrangler-dry-run` |
| YAML-Prüfung | Ruby YAML-Parser im Workflow `.github/workflows/validate.yml` |
| Browser-/Screenshotprüfung | Noch kein Playwright-/Screenshot-Workflow im Repository vorhanden |

**Baseline aus dem letzten Main-Run am 30.10.2026:**
- JavaScript-Syntaxprüfung: bestanden.
- GitHub-Actions-YAML-Prüfung: bestanden.
- Regressionstests: fehlgeschlagen, bevor die Wrangler-Prüfung ausgeführt wurde.
- Vorab-Fehler: Test `launch paths do not mutate D1 schema at request time` prüft weiterhin die Legacy-Datei `worker.js` und meldet dort `worker.js still contains runtime CREATE IF NOT EXISTS`. Das ist ein bereits vorhandener Test-/Legacy-Pfad-Fehler und wird als Vorab-Fehler dokumentiert; er wird nicht durch eine Änderung an Zahlungs- oder Worker-Logik „behoben“.
- Die letzten Main-Workflows für Pages-Build, Production-Worker-Deploy und Production-Smoke waren erfolgreich. Das ist keine Freigabe, den öffentlichen Launch-Gate oder Stripe-Live-Modus zu ändern.

### 6. Sicherheits- und Änderungsgrenzen

**Explizit nicht Teil des Redesigns:**
- Stripe Checkout, PaymentIntent-/Refund-/Transfer-Berechnungen und Zahlungsabläufe.
- Stripe-Webhooks und Settlement-Ledger.
- Affiliate-Links, Cookies, Attribution und Partnerzuordnung.
- Authentifizierung, Sessions, Berechtigungen und Anbieterzugänge.
- Suchlogik, Buchungslogik, API-Endpunkte, Worker-Routing und Datenbankschema.
- Produktions-Secrets, Cloudflare-/Stripe-Konfiguration, Live-Gates oder Deployments.

Erlaubt sind ausschließlich visuelle Änderungen und notwendige, nicht-funktionale Accessibility-Verbesserungen. Falls eine Designänderung einen Eingriff in die Sperrzone erfordert, wird sie ausgelassen und im Abschlussbericht als offener Punkt benannt.

### Phase 2 — Designsystem

- Zentrale Tokens und Basiskomponenten werden in `assets/css/fiiviu-design-system.css` gepflegt.
- Ein lokal gehosteter variabler Manrope-Font aus dem Google-Fonts-Repository wird mit OFL-Lizenz eingebunden; Quelle und Lizenz sind in `CREDITS.md` dokumentiert.
- Tokens definieren Farbpalette, kontraststarkes Orange für Links/Text, dunkle Textfarbe auf Orangeflächen, Typografie, Abstände, Radien, Schatten und Layoutbreiten.
- Die wiedererkennbare Moment-Kachel verwendet eine asymmetrische, weich gerundete Form und einen orangefarbenen Moment-Marker.
- Accessibility-Basics umfassen sichtbare Fokuszustände, Mindesthöhe für Buttons, System-Reduced-Motion und gut lesbare Formularfelder.

### Phase 3 — Startseite

- Die Startseite verwendet jetzt das gemeinsame Designsystem und ein eigenes, responsives Homepage-Stylesheet.
- Der Hero-Bereich hat eine stärkere redaktionelle Hierarchie, klaren CTA und schnelle Kategorie-Einstiege, die ausschließlich bestehende `showCategory`-Funktionen verwenden.
- Die Moment-Kategorien nutzen das wiedererkennbare Kachelmotiv und die vorhandenen Kategorie-IDs, Bildquellen und Datenattribute.
- Der Kategorien-Introbereich zeigt jetzt die bereits vorhandenen, in Deutsch/Englisch/Rumänisch gepflegten Texte `intro_title` und `intro_text`.
- Bestehende dynamische Angebotskarten, Checkout- und Buchungs-IDs sowie die SEO-Metadaten wurden nicht umgebaut.
- Es wurde bewusst kein Suchfeld mit Scheinverhalten eingeführt: Die vorhandene Startseite besitzt keine echte Suchschnittstelle; Suchlogik ist laut Sperrzone tabu. Die Hero-Schnelleinstiege nutzen nur bestehende Kategorieaktionen.

### Phase 4 — übrige Seiten

- Das gemeinsame Designsystem wird auf Anbieterregistrierung, Provider-/Organizer-Bereiche, Partner- und Affiliate-Seiten, Buchungs-/Bestätigungs-/Stornoseiten, Admin-Oberflächen und Rechtsseiten eingebunden.
- Die neuen Regeln vereinheitlichen Typografie, Formulare, Buttons, Fokuszustände, Karten, Tabellen, Abstände und mobile Lesbarkeit, ohne Form-IDs, Feldnamen, Event-Handler, API-Pfade oder Geschäftslogik zu verändern.
- Die E-Mail-Bestätigungsvorlage `emailjs-booking-confirmation.html` bleibt bewusst separat, weil sie als E-Mail-Markup und nicht als normale Website-Seite gerendert wird.
- Bestehende Bilder bleiben unverändert; ihre vorhandenen Unsplash-/Pexels-Quellen und Lizenzhinweise sind in `CREDITS.md` dokumentiert. Es wurden keine neuen Anbieterbilder oder fingierten Inhalte hinzugefügt.

### Phase 4 — übrige Seiten

- Das gemeinsame Designsystem und die zusätzlichen Seitenregeln sind auf Anbieterregistrierung, Provider-/Organizer-Bereiche, Partner- und Affiliate-Seiten, Buchungs-/Bestätigungs-/Stornoseiten, Admin-Oberflächen und Rechtsseiten eingebunden.
- Die Regeln vereinheitlichen Typografie, Formulare, Buttons, Fokuszustände, Karten, Tabellen, Abstände und mobile Lesbarkeit, ohne Form-IDs, Feldnamen, Event-Handler, API-Pfade oder Geschäftslogik zu verändern.
- Die E-Mail-Bestätigungsvorlage `emailjs-booking-confirmation.html` bleibt bewusst separat, weil sie als E-Mail-Markup und nicht als normale Website-Seite gerendert wird.
- Bestehende Bilder bleiben unverändert; vorhandene Unsplash-/Pexels-Quellen und Lizenzhinweise sind in `CREDITS.md` dokumentiert. Es wurden keine neuen Anbieterbilder oder fingierten Inhalte hinzugefügt.

### Phase 5 — Prüfung

- Die Test-Suite erhält Regressionstests für zentrale Design-Assets, Font-Hosting, alle relevanten HTML-Seiten, drei Sprachvarianten und die vorhandenen Kategorieaktionen.
- Ein bereits auf `main` vorhandener Testfehler wurde als falscher Prüfbereich identifiziert: `worker.js` ist ein Legacy-Modul und kein aktiver Request-Einstiegspunkt. Der Test prüft nun nur die aktiven Produktionspfade und sichert separat ab, dass diese `worker-entry.js` verwenden. Es wurde keine Worker- oder Zahlungslogik geändert.
- Kontrastwerte der zentralen Farbpaare: dunkles Orange `#A94717` auf Creme `#FBFAF7` = 5,59:1; dunkler Text `#241A16` auf Orange `#E86F2D` = 5,46:1; beide erfüllen WCAG AA für normalen Text.
- Eine Playwright-Visual-Review-Pipeline ist als reine CI-Dev-Abhängigkeit ergänzt. Der erste Browserlauf deckte einen zuvor fehlenden Kategorie-View-Container im Homepage-Markup auf; der vollständige bestehende Kategorie-View wurde aus der Main-Baseline wiederhergestellt. Der erste Lauf zeigte, dass Playwrights Chromium-Build auf dem vorläufigen `ubuntu-latest`-Image noch nicht unterstützt wird; der Runner wurde deshalb auf Ubuntu 24.04 festgesetzt. Sie erstellt Screenshots bei 360/768/1280 px und prüft horizontalen Overflow sowie die lokale Font-Bereitschaft; der erste Lauf scheiterte vor dem Browserstart an der nicht unterstützten Ubuntu-26.04-Runner-Version. Der zweite Lauf fand anschließend den fehlenden Kategorie-Container; nach dessen Wiederherstellung wird die visuelle Prüfung erneut ausgeführt.

### 7. Nächste Phasen

1. **Phase 2 — Designsystem:** zentrale Tokens und wiederverwendbare visuelle Basiskomponenten; Kontrast- und Fokusregeln dokumentieren.
2. **Phase 3 — Startseite:** Startseite mit bestehenden Übersetzungs- und Datenbindungen neu gestalten.
3. **Phase 4 — Unterseiten:** Suche/Kategorien, Provider, Buchungs-/Angebotsseiten, Registrierung/Login, Partner/Affiliate, Checkout-Styling, Admin-/Legal- und Systemzustände.
4. **Phase 5 — Prüfung:** Regressionen, responsive Sichtprüfung (360/768/1280 px), Tastaturbedienung, reduzierte Bewegung und mobile Überläufe prüfen.

Jede Phase erhält einen eigenen Commit, eine Aktualisierung dieser Datei und eine erneute Prüfung, bevor die nächste Phase beginnt.


### Nachbesserung nach Sichtprüfung

- Die CI-Screenshots wurden zusätzlich manuell angesehen. Dabei fiel auf, dass der Hero auf sehr schmalen Geräten die Location-/CTA-Reihenfolge nicht klar genug vermittelte und die Inhaltsfläche durch die vererbte Mindesthöhe unnötig hoch wurde.
- Die mobile Hero-Komposition wurde daher explizit geordnet (Standort, Headline, Beschreibung, CTA, Kategorie-Chips), die Mindesthöhe und Innenabstände wurden neu ausbalanciert. Die Desktop- und Tablet-Regeln bleiben unberührt.
- Die Responsive-Screenshots und Overflow-Prüfungen laufen nach dieser Korrektur erneut.
