# MieWeG-Indexierungsrechner - Manuelle Testfälle

## Rechtsgrundlage

Das **Mieten-Wertsicherungsgesetz (MieWeG)** regelt ab 2026:
- **Hälfteregelung**: Inflation > 3% wird nur zur Hälfte weitergegeben
- **2026 Cap**: Kategorie-/Richtwertmieten max. 1%
- **2027 Cap**: Kategorie-/Richtwertmieten max. 2%
- **April 1 Regel**: Indexierung erst ab 01.04. des Jahres möglich
- **Jährliche Beschränkung**: Nur einmal pro Jahr
- **Ein-/Zweifamilienhäuser**: Vom MieWeG ausgenommen

---

## Testfall 1: Hälfteregelung bei hoher Inflation

**Szenario**: Freier Mietmarkt bei 6% Inflation

**Eingabe**:
| Feld | Wert |
|------|------|
| Mietart | Freier Markt |
| Aktuelle Miete | 1.000,00 EUR |
| VPI-Inflation | 6,0% |
| Jahr | 2026 |

**Berechnung**:
- Erste 3%: voll → 3,0%
- Überschuss (3%): halbe → 1,5%
- **Gesamt: 4,5%**

**Erwartetes Ergebnis**:
- Zulässige Erhöhung: 4,5%
- Erhöhungsbetrag: 45,00 EUR
- Neue Miete: 1.045,00 EUR

**Prüfpunkte**:
- [ ] Hälfteregelung-Erklärung wird angezeigt
- [ ] Berechnung korrekt

---

## Testfall 2: 2026 Kategoriemiete-Cap

**Szenario**: Wiener Altbau-Kategoriemiete

**Eingabe**:
| Feld | Wert |
|------|------|
| Mietart | Kategoriemiete |
| Aktuelle Miete | 485,75 EUR |
| VPI-Inflation | 4,2% |
| Jahr | 2026 |

**Erwartetes Ergebnis**:
- Zulässige Erhöhung: 1,0% (gedeckelt)
- Erhöhungsbetrag: 4,86 EUR
- Neue Miete: 490,61 EUR

**Prüfpunkte**:
- [ ] Cap-Hinweis "max. 1% für 2026" angezeigt
- [ ] Inflation wird nicht voll weitergegeben

---

## Testfall 3: 2027 Richtwertmiete-Cap

**Szenario**: Richtwertmiete 2027

**Eingabe**:
| Feld | Wert |
|------|------|
| Mietart | Richtwertmiete |
| Aktuelle Miete | 720,00 EUR |
| VPI-Inflation | 5,0% |
| Jahr | 2027 |

**Erwartetes Ergebnis**:
- Zulässige Erhöhung: 2,0% (gedeckelt)
- Erhöhungsbetrag: 14,40 EUR
- Neue Miete: 734,40 EUR

**Prüfpunkte**:
- [ ] Cap-Hinweis "max. 2% für 2027" angezeigt

---

## Testfall 4: Ein-/Zweifamilienhaus-Ausnahme

**Szenario**: Einfamilienhaus vermietet

**Eingabe**:
| Feld | Wert |
|------|------|
| Ein-/Zweifamilienhaus | Ja (aktiviert) |
| Mietart | Freier Markt |
| Aktuelle Miete | 1.500,00 EUR |
| VPI-Inflation | 5,0% |
| Jahr | 2026 |

**Erwartetes Ergebnis**:
- Warnung: "MieWeG nicht anwendbar"
- Keine Erhöhungsberechnung
- Hinweis auf freie Vereinbarung

**Prüfpunkte**:
- [ ] Warnung wird deutlich angezeigt
- [ ] Kein Erhöhungsbetrag berechnet

---

## Testfall 5: April 1 Regel

**Szenario**: Versuch einer Indexierung vor 01.04.

**Eingabe**:
| Feld | Wert |
|------|------|
| Letzte Indexierung | 01.04.2025 |
| Heutiges Datum | 15.03.2026 |
| Jahr | 2026 |

**Erwartetes Ergebnis**:
- Warnung: "Indexierung frühestens am 01.04.2026 möglich"
- Nächstes Indexierungsdatum angezeigt

**Prüfpunkte**:
- [ ] Datum-Validierung funktioniert
- [ ] Klare Fehlermeldung

---

## Testfall 6: Jährliche Beschränkung

**Szenario**: Zweite Indexierung im selben Jahr

**Eingabe**:
| Feld | Wert |
|------|------|
| Letzte Indexierung | 15.06.2025 |
| Heutiges Datum | 01.05.2026 |
| Jahr | 2026 |

**Erwartetes Ergebnis**:
- Warnung: "Weniger als ein Jahr seit letzter Indexierung"
- Nächstes mögliches Datum: 15.06.2026

**Prüfpunkte**:
- [ ] Jahresfrist wird geprüft
- [ ] Korrektes Folgdatum angezeigt

---

## Testfall 7: Niedrige Inflation (< 3%)

**Szenario**: Inflation unter der Hälfteregelungs-Schwelle

**Eingabe**:
| Feld | Wert |
|------|------|
| Mietart | Freier Markt |
| Aktuelle Miete | 800,00 EUR |
| VPI-Inflation | 2,5% |
| Jahr | 2026 |

**Erwartetes Ergebnis**:
- Zulässige Erhöhung: 2,5% (volle Inflation)
- Erhöhungsbetrag: 20,00 EUR
- Neue Miete: 820,00 EUR
- Hinweis: "Volle Weitergabe da ≤ 3%"

**Prüfpunkte**:
- [ ] Keine Hälfteregelung angewendet
- [ ] Erklärung korrekt

---

## Testfall 8: 2028+ Kategoriemiete (Hälfteregelung)

**Szenario**: Kategoriemiete nach Übergangsphase

**Eingabe**:
| Feld | Wert |
|------|------|
| Mietart | Kategoriemiete |
| Aktuelle Miete | 550,00 EUR |
| VPI-Inflation | 5,0% |
| Jahr | 2028 |

**Erwartetes Ergebnis**:
- Zulässige Erhöhung: 4,0% (Hälfteregelung)
- Erhöhungsbetrag: 22,00 EUR
- Neue Miete: 572,00 EUR

**Prüfpunkte**:
- [ ] Kein Cap mehr aktiv für 2028
- [ ] Hälfteregelung wird angewendet

---

## Browser-Testpfad

1. **Navigation**: Buchhalter → MieWeG-Rechner
2. **Eingabe**: Liegenschaft und Mieter auswählen (oder manuell eingeben)
3. **Berechnung**: Button "Berechnen" klicken
4. **Ergebnis**: 
   - Neue Miete angezeigt
   - Erklärung mit Formel
   - Nächstes Indexierungsdatum
5. **Export**: PDF-Brief generieren

---

## Erfolgs-Kriterien

- [ ] Alle 8 Testfälle erfolgreich
- [ ] Hälfteregelung korrekt: 3% + (Überschuss × 0,5)
- [ ] 2026 Cap: max. 1% für Kategorie/Richtwert
- [ ] 2027 Cap: max. 2% für Kategorie/Richtwert
- [ ] April 1 Regel wird durchgesetzt
- [ ] Ein-/Zweifamilienhäuser ausgenommen
- [ ] PDF-Export mit korrekter Berechnung
