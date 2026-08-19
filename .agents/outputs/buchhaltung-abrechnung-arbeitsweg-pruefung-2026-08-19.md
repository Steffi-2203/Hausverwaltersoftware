# Arbeitsweg-Prüfung: Buchhaltung & Abrechnung

**Stand:** 19. August 2026  
**Umfang:** reine Bestandsaufnahme; keine Produkt-, Schema- oder Konfigurationsänderungen.  
**Sicherheitsgrenze:** Kein echter Bankverkehr und keine E-Mail an reale Empfänger ausgelöst.

## Kurzurteil

**Nein — ein Buchhalter oder Verwalter kann den vollständigen Arbeitstag derzeit
nicht durchgängig in ImmoFlowMe abwickeln.** Der erste fachliche Bruch liegt
bereits bei **OCR-Rechnung → offene Eingangsrechnung**: Die OCR liefert einen
Vorschlag zurück, erzeugt aber selbst keinen Beleg, keine Eingangsrechnung,
keinen offenen Posten und keine Buchung.

Die einzelnen Rechenkerne für BK, WEG und Teilzahlungen sind zu wesentlichen
Teilen getestet. Die Übergaben zwischen Beleg, Bank, Buchhaltung, Abrechnung
und Zustellung sind dagegen nicht geschlossen.

## Ausführung und Bereinigung

Ausgeführt wurden isolierte Tests ohne Bank- oder Mail-Nebenwirkung:

- `mrg-betriebskosten-abrechnung.test.ts`
- `weg-jahresabrechnung-berechnung.test.ts`
- `weg-settlement-send.test.ts`
- `ebics-stub.test.ts`
- `weg-teilzahlung.test.ts`
- `weg-teilzahlung-ist-wert.test.ts`
- `payment-allocation.test.ts`
- `ocr-review-audit.test.ts`
- `batch-ocr-review.test.ts`

**Ergebnis:** 147 Tests bestanden, 0 fehlgeschlagen.

Der vorhandene `e2e-billing-cycle.test.ts` brach unabhängig von der
Fachlogik ab: `tests/unit/e2e-billing-cycle.test.ts:40` verwendet den
RLS-gebundenen `db`-Proxy ohne Organisationskontext; dieser wirft in
`server/db.ts:228`. Der Test hatte davor zwei klar markierte Testhierarchien
angelegt und erreichte sein Cleanup nicht. Diese wurden anschließend gezielt
gelöscht und geprüft: Organisationen, Profile, Liegenschaften, Einheiten und
Mieter jeweils **0 Restzeilen**.

## Befund nach Prüfblock

| Block | Status | Sichtbares Ergebnis / Ursache |
|---|---|---|
| 1.1 Anlage/Liegenschaft per OCR | **fehlt** | Die vorhandenen OCR-Wege lesen Rechnungen bzw. Zählerstände, nicht Kaufvertrag/Grundbuch/Bestandsliste zur automatischen Anlageerstellung. |
| 1.2 Eingangsrechnung per OCR | **bricht** | OCR-Vorschlag und Korrektur-Audit funktionieren; es gibt keinen Übergang zur gespeicherten Eingangsrechnung oder zum offenen Posten. |
| 2.1 Zahlung auslösen | **teilweise** | SEPA-Dateien inklusive IBAN-Prüfung werden erzeugt. EBICS-Transport ist bewusst nicht implementiert und bricht fail-closed. |
| 2.2 Zahlungseingang zuordnen | **teilweise** | CAMT.053 kann lesen; die Zahlungsallokation kann Teilzahlungen rechnen. Eine durchgehende, nachweisbare CAMT→Allokation fehlt. |
| 3.1 BK-Abrechnung | **teilweise** | Centgenaue Verteilung ist nachgewiesen. Der durchgängige Lebenszyklus aus Kosten, Vorschüssen, Buchhaltung, Ausgabe und Versand ist nicht nachgewiesen. |
| 3.2 BK-Vorschreibungs-Abgleich | **fehlt** | Keine belastbare sofortige Soll/Ist-Ansicht aus tatsächlichen Kosten, Vorschüssen und Bankzahlungen gefunden. |
| 4.1 WEG-Jahresabrechnung | **teilweise** | Nutzwert/MEA, Rücklage und Teilzahlungen werden im Rechenkern verarbeitet. Kein Übergang in Journale, offene Posten oder Bankabgleich. |
| 4.2 WEG-Vorschreibungs-Abgleich | **bricht** | Ist-Werte kommen aus `paidAmount`/Status der Vorschreibung, nicht automatisch aus Bankzahlungen oder `payment_allocations`. |
| 5 Plausibilität vor Versand | **fehlt** | Die vorhandene Validierung vergleicht nur Detail-Soll gegen gespeicherte Ausgabensumme; keine vollständige Finanz-, Beleg-, Zahlungs- oder Rücklagenprüfung. |
| 6 Ausgabe und Versand | **bricht** | WEG-Ausgabe ist druckbares HTML statt gespeichertem PDF/Dokument. E-Mail versendet HTML ohne Anhang; Wiederholung kann doppelt senden. |

## Block 1 — OCR und Belege

### 1.1 Liegenschaft/Anlage

**Status: fehlt.** Die mobilen und Web-OCR-Wege verarbeiten Rechnungsbilder:

- `artifacts/immo-ocr-mobile/app/scan.tsx:127-174`
- `artifacts/immo-flow-me/src/pages/ExpenseList.tsx:603-650`
- `artifacts/immo-flow-me/src/pages/InvoiceOcr.tsx:84-116`

Der primäre Endpunkt `server/functions.ts:673-789` prüft Bildtyp/-größe,
fragt das Modell ab und markiert niedrige Sicherheit oder fehlende Pflichtwerte
mit `needs_review`. Er speichert aber weder Anlage noch Dokument noch
Rechnung. Für Kaufvertrag, Grundbuchauszug oder Bestandsliste existiert kein
automatischer Anlage-Import.

### 1.2 Eingangsrechnung

**Status: bricht am Übergang in die Buchhaltung.**

- Die OCR-Antwort enthält extrahierte Rechnungsfelder und `needs_review`
  (`server/functions.ts:673-789`).
- Die mobile Korrektur schreibt ausschließlich ein Audit-Ereignis
  (`app/review.tsx:66-179`, `server/routes/ocrRoutes.ts:14-67`).
- Die tatsächliche Anlage einer Eingangsrechnung ist ein separater, manueller
  API-Weg (`server/routes/incomingInvoiceRoutes.ts:53-191`).

Der sichtbare Effekt: Nach dem OCR-Review liegt ein Vorschlag bzw. ein
Korrekturprotokoll vor, aber keine gespeicherte Lieferantenrechnung und kein
offener Posten.

Die Review-Regeln sind dennoch getestet: vollständige, sichere Daten brauchen
keine Prüfung; fehlender Betrag/Lieferant, Fehler oder niedrige Sicherheit
lösen sie aus (`tests/unit/ocr-review-audit.test.ts`,
`tests/unit/batch-ocr-review.test.ts`).

## Block 2 — Zahlung und Bank

### 2.1 SEPA und EBICS

**SEPA: funktioniert als Dateiexport, nicht als Bankversand.**

- Modulo-97-IBAN-Prüfung: `server/services/sepaExportService.ts:47-72`
- BIC-Prüfung: `:74-80`
- Restbetrag bei Teilzahlung, entschlüsselte IBAN/BIC und Mandatsprüfung:
  `:156-182`
- pain.008-Datei: `:215-260`
- pain.001-Datei: `:304-337`

Ungültige Bankdaten, fehlendes Mandat oder nicht positive Beträge werden nicht
blind exportiert. Sichtbar ist eine XML-Datei; der Export ist kein
Überweisungsauftrag an eine Bank.

**EBICS: fehlt absichtlich/fail-closed.** `server/services/ebicsService.ts:31-55`
erklärt den nicht implementierten Transport. `:78-87` wirft immer
`EbicsNotImplementedError`; Aktivierung und C53-Abruf treffen diesen Pfad
(`:182-220`). Der ausgeführte Stub-Test bestätigt das auch bei
`EBICS_ENABLED=true` (`tests/unit/ebics-stub.test.ts:17-64`).

### 2.2 CAMT und Teilzahlung

**Status: teilweise.**

- CAMT.053 wird geparst (`server/services/camt053Service.ts:50-159`).
- Die Zahlungslogik verteilt Zahlungen ältestenoffenen Rechnungen zu, setzt
  `paid_amount`/Status, schreibt `payment_allocations` und Audit
  (`server/services/paymentService.ts:94-161`).
- Der Route-Einstieg liegt bei `server/routes/accountingRoutes.ts:904-951`.

Der kritische Übergang CAMT-Datei → automatische Allokation ist nicht
nachgewiesen. Teilzahlungen können fachlich gerechnet werden, aber der Import
liefert nicht sichtbar den vollständigen automatischen Bankabgleich.

Handbeleg für die Aufteilungslogik: Bei 925 EUR werden 180 EUR BK, 95 EUR
Heizung und 650 EUR Miete priorisiert; bei 230 EUR ergeben sich 180 EUR BK +
50 EUR Heizung (`tests/unit/payment-allocation.test.ts:61-310`).

## Block 3 — Betriebskostenabrechnung

**Status: Rechenkern funktioniert, Gesamtprozess teilweise.**

`server/services/settlementService.ts:167-242` verteilt in Cent mit
Restcentverfahren; Speicherung erfolgt in `:345-387`.

Handrechnung aus dem ausgeführten Test:

| Mieter | Fläche | Rechnung | Anteil |
|---|---:|---:|---:|
| 1 | 50 m² | 1.200 × 50 / 200 | 300,00 EUR |
| 2 | 70 m² | 1.200 × 70 / 200 | 420,00 EUR |
| 3 | 80 m² | 1.200 × 80 / 200 | 480,00 EUR |
| **Summe** | **200 m²** |  | **1.200,00 EUR** |

Das ist im Test `tests/unit/mrg-betriebskosten-abrechnung.test.ts:18-35`
bestätigt. Ein 1-Cent-Rest wird nach dem größten Dezimalrest vergeben, nicht
willkürlich verloren.

Nicht belegt ist der vollständige Weg von erfasster Lieferantenrechnung über
offene Posten, Vorschüsse und Bankzahlungen bis zur finalen,
empfängerspezifischen BK-Ausgabe. Eine sofortige, belastbare Soll/Ist-Ansicht
für Vorschüsse gegen Kosten und Zahlungseingänge wurde nicht gefunden.

## Block 4 — WEG-Abrechnung

**Status: Rechenkern funktioniert, finanzielle Übergaben fehlen.**

`server/services/wegSettlementService.ts:288-387` berechnet Eigentümeranteile;
Saldo und Ist-Werte folgen in `:430-501`; Vorauszahlungen werden in
`:97-126` ausgewertet.

Handrechnung aus dem ausgeführten Szenario:

- Eigentümer A: 50 % Anteil.
- Laufender Aufwand 600 EUR → 300 EUR.
- Rücklage 600 EUR → 300 EUR, separat ausgewiesen.
- Sonderumlage 300 EUR → 150 EUR.
- Im getesteten Szenario kommt eine weitere 600-EUR-Kategorie hinzu:
  **Soll A = 1.050 EUR**.
- Bei einer 250-EUR-Vorschreibung mit Teilzahlung `paidAmount = 125,50 EUR`:
  **Ist = 125,50 EUR, Saldo = 924,50 EUR**.

Belegt durch `tests/unit/weg-jahresabrechnung-berechnung.test.ts:274-327`
und `tests/unit/weg-teilzahlung.test.ts:76-87,148-179`. Die Teilzahlung wird
validiert: nicht positiv, gleich/über Gesamtbetrag oder Sub-Cent-Werte werden
abgewiesen; ein Statuswechsel zurück auf offen/überfällig löscht `paid_amount`.

Der Ist-Wert ist jedoch der manuell/gepflegt gespeicherte
`weg_vorschreibungen.paidAmount`, nicht eine nachgewiesene Bankallokation.
Eine erzeugte WEG-Abrechnung bucht weder Journalzeilen noch Forderungen oder
Zahlungsausgleiche (`wegSettlementService.ts:521-556`).

## Block 5 — Plausibilität

**Status: fehlt als vollständige Versandfreigabe.**

`server/services/trialBalanceService.ts:170-201` vergleicht bei
`validateSettlementTotals` nur die Summe der WEG-Detail-Sollwerte gegen
`totalExpenses`. Es prüft nicht:

- Buchungsjournal und Bankzahlungen,
- Belegvollständigkeit,
- Vorschreibungs-Gegenposten,
- Rücklagenbewegungen,
- Vollständigkeit aller Empfänger,
- fachliche Versandfreigabe.

Damit ist die sichtbare Validierung keine vollständige Plausibilitäts- oder
Abschlusskontrolle.

## Block 6 — Ausgabe und Versand

**Status: bricht bei dauerhafter Ausgabe und sicherer Wiederholung.**

- `GET /api/weg/settlement/:id/pdf` liefert druckbares HTML mit
  `window.print()`, aber kein serverseitig erzeugtes/gespeichertes PDF
  (`server/routes/wegRoutes.ts:2017-2061`).
- Der E-Mail-Weg (`:2067-2143`,
  `server/services/wegSettlementEmailService.ts:36-167`) versendet
  eigentümerspezifisches HTML ohne PDF-Anhang und protokolliert Erfolg/Fehler
  in `weg_settlement_emails`.
- Wiederholen kann doppelt zustellen, weil vorhandene Versandprotokolle nicht
  als Idempotenzschutz verwendet werden. Ein Teil-Erfolg setzt den Status
  bereits auf `versendet`, obwohl andere Empfänger scheitern können.
- Eine gespeicherte Dokument-/Portalübergabe für die WEG-Jahresabrechnung
  wurde nicht gefunden.

Die Versandtests sind technisch grün, weil sie Sendefunktionen stubs verwenden:
Erfolg, Teilerfolg, Gesamtausfall, fehlende Mailadresse und HTTP-Fehler werden
getestet (`tests/unit/weg-settlement-send.test.ts:172-270`). Das ist kein
Nachweis einer sicheren realen Zustellung.

## Querschnitt: die drei Übergaben

| Übergabe | Befund |
|---|---|
| OCR-Rechnung → offener Posten → BK-Kostenposition | **fehlt.** OCR endet mit Vorschlag/Audit; Eingangsrechnung und Kostenposition sind separate manuelle Wege. |
| Zahlungseingang → Rückstand | **teilweise.** `paymentService` kann Rechnungssaldo und Teilzahlung fortschreiben; CAMT-Import → automatische Allokation ist nicht belegt. Für WEG fehlt die Bankanbindung an `paidAmount`. |
| Abrechnung → Buchhaltung/Folgeforderung | **fehlt.** BK- und WEG-Erstellung erzeugen keine Journalzeilen, Forderungen oder Zahlungsausgleiche. Generische Buchungslogik ist separat (`server/routes/accountingRoutes.ts:248-312`). |

## Automatisierungsgrad

| Schritt | Bewertung |
|---|---|
| OCR lesen und Prüfhinweis bilden | halbautomatisch |
| OCR-Korrektur protokollieren | automatisch |
| OCR-Ergebnis als Eingangsrechnung/offener Posten speichern | fehlt |
| SEPA-XML erzeugen und IBAN prüfen | automatisch |
| Bankübertragung via EBICS | fehlt |
| CAMT lesen | halbautomatisch |
| CAMT automatisch zu offenen Posten zuordnen | nicht nachgewiesen / teilweise |
| BK-Centverteilung | automatisch |
| WEG-Anteile, Rücklage und Teilzahlung rechnen | automatisch |
| Abrechnung in Journal/offene Posten überführen | fehlt |
| Vollständige Plausibilitätsfreigabe | fehlt |
| Dauerhaftes PDF/Portal-Dokument erzeugen | fehlt |
| E-Mail-Zustellung wiederholsicher protokollieren | teilweise |

## Was wirkt wie Automatik, ist aber keine durchgängige Automatik?

1. **OCR:** Das Ergebnis wirkt wie eine erfasste Rechnung, wird aber nicht
   automatisch als Rechnung/offener Posten verbucht.
2. **EBICS:** Einstellungen und Endpunkte existieren, der Transport ist jedoch
   absichtlich nicht implementiert und meldet sich als nicht verfügbar.
3. **„PDF“/Versand:** WEG liefert druckbares HTML; es entsteht kein dauerhaftes
   Dokument. Versandprotokolle verhindern keine Doppelzustellung.
4. **Plausibilität:** Der vorhandene Summenvergleich ist keine Finanz- oder
   Belegabstimmung.

## Technische Verlässlichkeit (keine Rechtsberatung)

Dieser Befund ist eine technische Prüfung, keine rechtliche Freigabe. Auf die
isoliert getesteten Rechenkerne für BK-Centverteilung und WEG-Teilzahlungen
kann man sich als Komponentenbefund stützen. Für eine rechtssichere bzw.
vollständig nachvollziehbare End-to-End-Abrechnung reicht der aktuelle
Arbeitsweg technisch nicht aus, weil Buchungs-, Bank-, Dokument- und
Zustellungsnachweise nicht geschlossen verknüpft sind.

## Drei zwingende Lücken

1. **Beleg zu Buchhaltung schließen:** Bestätigtes OCR-Ergebnis muss eine
   nachvollziehbare Eingangsrechnung, einen offenen Posten und eine
   Kostenposition erzeugen bzw. verknüpfen.
2. **Finanzielle Kette schließen:** CAMT-Zahlung → Allokation → Vorschreibung/
   Rückstand sowie Abrechnung → Journal/Forderung/Ausgleich müssen
   organisationssicher und idempotent verbunden werden.
3. **Abschluss und Zustellung belastbar machen:** Vollständige Plausibilitäts-
   sperre, gespeichertes empfängerbezogenes PDF/Portal-Dokument sowie
   wiederholsicherer Versand mit vollständigem Protokoll.