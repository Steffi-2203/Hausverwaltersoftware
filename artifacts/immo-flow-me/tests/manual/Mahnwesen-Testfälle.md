# Mahnwesen - Manuelle Testfälle

## Rechtsgrundlage

Das österreichische Mahnwesen basiert auf:
- **ABGB §1333**: Verzugszinsen (4% Basiszins + 4% = 8% für Verbraucher)
- **3-Stufen-Eskalation**: Zahlungserinnerung → Mahnung → Inkasso
- **Mahnfristen**: 14 Tage nach Fälligkeit, dann 30 Tage

---

## Testfall 1: Verzugszinsen-Berechnung (Verbraucher)

**Szenario**: Mieter ist 30 Tage im Verzug

**Eingabe**:
| Feld | Wert |
|------|------|
| Ausstehender Betrag | 1.000,00 EUR |
| Tage überfällig | 30 |
| Zinssatz | 8% (Verbraucher) |

**Berechnung**:
- Tageszinssatz: 8% / 365 = 0,0219%
- Zinsen: 1.000 × 0,0219% × 30 = 6,58 EUR

**Erwartetes Ergebnis**:
- Verzugszinsen: 6,58 EUR
- Gesamtforderung: 1.006,58 EUR

**Prüfpunkte**:
- [ ] Zinsberechnung korrekt
- [ ] Tageszins-Formel angewendet

---

## Testfall 2: Mahnstufen-Eskalation

**Szenario**: Automatische Mahnstufen-Erhöhung

| Tage überfällig | Mahnstufe | Aktion |
|-----------------|-----------|--------|
| 0-14 | 0 | Keine Mahnung |
| 15-30 | 1 | Zahlungserinnerung |
| 31+ | 2 | Mahnung |

**Prüfpunkte**:
- [ ] Stufe 0 → 1 nach 14 Tagen
- [ ] Stufe 1 → 2 nach 30 Tagen
- [ ] Keine automatische Stufe 3

---

## Testfall 3: Zahlungserinnerung senden

**Szenario**: Erste Erinnerung bei 15 Tagen Verzug

**Voraussetzungen**:
- Mieter: Schmidt Hans
- E-Mail: schmidt@example.com
- Betrag: 925,80 EUR
- Fällig: vor 15 Tagen

**Erwartetes Ergebnis**:
- E-Mail wird versendet
- Betreff enthält "Zahlungserinnerung"
- Mahnstufe auf 1 gesetzt
- Datum der Erinnerung protokolliert

**Prüfpunkte**:
- [ ] E-Mail-Versand erfolgreich
- [ ] Mahnstufe aktualisiert
- [ ] Verzugszinsen berechnet

---

## Testfall 4: Mahnung senden (Stufe 2)

**Szenario**: Zweite Mahnstufe nach 31 Tagen

**Voraussetzungen**:
- Mieter hat bereits Zahlungserinnerung erhalten
- Zahlung weiterhin ausständig
- 31 Tage überfällig

**Erwartetes Ergebnis**:
- E-Mail mit "Mahnung" Betreff
- Inkasso-Androhung im Text
- Höhere Verzugszinsen berechnet
- Mahnstufe auf 2 gesetzt

**Prüfpunkte**:
- [ ] Eskalierte Tonalität im Text
- [ ] Fristsetzung enthalten
- [ ] Verzugszinsen für 31+ Tage

---

## Testfall 5: Gewerbemieter (höherer Zinssatz)

**Szenario**: Gewerbemieter mit 9,2% Verzugszinsen

**Eingabe**:
| Feld | Wert |
|------|------|
| Mietertyp | Gewerbe |
| Ausstehender Betrag | 2.500,00 EUR |
| Tage überfällig | 45 |
| Zinssatz | 9,2% (B2B) |

**Berechnung**:
- Tageszinssatz: 9,2% / 365 = 0,0252%
- Zinsen: 2.500 × 0,0252% × 45 = 28,36 EUR

**Erwartetes Ergebnis**:
- Verzugszinsen: 28,36 EUR
- Gesamtforderung: 2.528,36 EUR

**Prüfpunkte**:
- [ ] Korrekter B2B-Zinssatz angewendet
- [ ] Gewerbemieter erkannt

---

## Testfall 6: Teilzahlung bei Mahnung

**Szenario**: Mieter zahlt teilweise nach Mahnung

**Voraussetzungen**:
- Offener Betrag: 1.000,00 EUR
- Verzugszinsen: 15,00 EUR
- Teilzahlung: 500,00 EUR

**Erwartetes Ergebnis**:
- Teilzahlung wird verbucht
- Neuer offener Betrag: 515,00 EUR
- Mahnstufe bleibt aktiv

**Prüfpunkte**:
- [ ] Teilzahlung korrekt verbucht
- [ ] Restbetrag aktualisiert
- [ ] Mahnstufe nicht zurückgesetzt

---

## Testfall 7: Vollständige Zahlung - Mahnung zurücksetzen

**Szenario**: Mieter zahlt vollständig nach Mahnung

**Voraussetzungen**:
- Offener Betrag inkl. Zinsen: 1.015,00 EUR
- Zahlung: 1.015,00 EUR

**Erwartetes Ergebnis**:
- Rechnung als "bezahlt" markiert
- Mahnstufe auf 0 zurückgesetzt
- Kein weiterer Mahnungslauf

**Prüfpunkte**:
- [ ] Status "bezahlt"
- [ ] Mahnstufe zurückgesetzt
- [ ] Keine weitere Mahnung

---

## Browser-Testpfad

1. **Navigation**: Finanzen → Offene Posten
2. **Filter**: Überfällige Rechnungen anzeigen
3. **Auswahl**: Rechnung mit Verzug wählen
4. **Aktion**: "Mahnung senden" klicken
5. **Prüfung**:
   - Vorschau der E-Mail
   - Verzugszinsen angezeigt
6. **Versand**: Bestätigen und senden

---

## Erfolgs-Kriterien

- [ ] Alle 7 Testfälle erfolgreich
- [ ] §1333 ABGB Verzugszinsen korrekt (8%/9,2%)
- [ ] 3-Stufen-Eskalation funktioniert
- [ ] E-Mail-Versand erfolgreich
- [ ] Teilzahlungen korrekt verbucht
- [ ] Mahnstufen werden protokolliert
