# SEPA-Export - Manuelle Testfälle

## Rechtsgrundlage

SEPA-Exporte müssen den folgenden Standards entsprechen:
- **pain.008.001.02**: Lastschriften (Direct Debit)
- **pain.001.001.03**: Überweisungen (Credit Transfer)
- **ISO 20022**: Internationale Finanz-Nachrichtenstandards

---

## Testfall 1: Lastschrift-Export (pain.008.001.02)

**Szenario**: Monatliche Mieteinzüge für 3 Mieter

**Voraussetzungen**:
| Mieter | IBAN | BIC | Betrag |
|--------|------|-----|--------|
| Müller Maria | AT61 1904 3002 3457 3201 | BKAUATWW | 925,80 EUR |
| Schmidt Hans | AT32 3200 0000 0120 0533 | RLNWATWW | 1.150,50 EUR |
| Weber Franz | AT48 2011 1000 0080 0666 | GIBAATWW | 780,00 EUR |

**Erwartetes Ergebnis**:
- XML-Datei wird generiert
- Header enthält korrektes Datum und Anzahl Transaktionen (3)
- Kontrollsumme: 2.856,30 EUR
- Alle IBANs ohne Leerzeichen

**Prüfpunkte**:
- [ ] XML-Struktur valide (pain.008.001.02 Schema)
- [ ] Alle Pflichtfelder vorhanden
- [ ] Beträge mit 2 Dezimalstellen
- [ ] Referenzen korrekt (Miete MM/YYYY)

---

## Testfall 2: Überweisung-Export (pain.001.001.03)

**Szenario**: Auszahlung von Betriebskosten-Guthaben

**Voraussetzungen**:
| Empfänger | IBAN | Betrag | Verwendungszweck |
|-----------|------|--------|------------------|
| Huber Anna | AT61 1904 3002 3457 3201 | 245,80 EUR | BK-Guthaben 2025 |

**Erwartetes Ergebnis**:
- XML-Datei im pain.001.001.03 Format
- Korrekte Kontoverbindung des Auftraggebers

**Prüfpunkte**:
- [ ] XML-Schema korrekt
- [ ] Betrag positiv
- [ ] Verwendungszweck max. 140 Zeichen

---

## Testfall 3: IBAN-Validierung

**Szenario**: Ungültige IBANs werden abgewiesen

| IBAN | Erwartung |
|------|-----------|
| AT611904300234573201 | Gültig |
| AT61 1904 3002 3457 3201 | Gültig (mit Leerzeichen) |
| AT611904300234573202 | Ungültig (falsche Prüfziffer) |
| AT61190430023457320 | Ungültig (zu kurz) |
| DE89370400440532013000 | Gültig (deutsche IBAN) |
| INVALIDIBAN | Ungültig (Format) |

**Prüfpunkte**:
- [ ] Validierung vor Export
- [ ] Fehlermeldung bei ungültiger IBAN
- [ ] Warnung wenn BIC fehlt

---

## Testfall 4: Sonderzeichen in Namen

**Szenario**: Namen mit Sonderzeichen müssen XML-escaped werden

| Name | Erwartet im XML |
|------|-----------------|
| Müller & Söhne | Müller &amp; Söhne |
| O'Brien | O&apos;Brien |
| "Test GmbH" | &quot;Test GmbH&quot; |
| Preis < 100 | Preis &lt; 100 |

**Prüfpunkte**:
- [ ] Ampersand korrekt escaped
- [ ] Anführungszeichen korrekt
- [ ] XML bleibt valide

---

## Testfall 5: Leerer Export

**Szenario**: Keine Mieter mit gültiger IBAN

**Erwartetes Ergebnis**:
- Fehlermeldung: "Keine gültigen Lastschriften gefunden"
- Kein Download angeboten

**Prüfpunkte**:
- [ ] Benutzerfreundliche Fehlermeldung
- [ ] Keine leere XML-Datei

---

## Browser-Testpfad

1. **Navigation**: Buchhalter → SEPA-Export
2. **Auswahl**: Liegenschaft und Monat wählen
3. **Prüfung**:
   - Liste der Mieter mit IBANs angezeigt
   - Kontrollsumme korrekt
4. **Export**: Lastschrift-XML herunterladen
5. **Validierung**: XML gegen Schema prüfen

---

## Erfolgs-Kriterien

- [ ] Alle 5 Testfälle erfolgreich
- [ ] IBAN-Validierung funktioniert
- [ ] BIC-Warnung bei fehlenden Werten
- [ ] XML-Escape für Sonderzeichen
- [ ] Download funktioniert
- [ ] Bank akzeptiert Datei (Produktionstest)
