# Verteilerschlüssel - Manuelle Testfälle

## Rechtsgrundlage

Die MRG-konformen Verteilerschlüssel für Betriebskosten:
- **MEA**: Miteigentumsanteile (‰)
- **Nutzfläche (QM)**: Quadratmeter-basiert
- **Personen**: Personenanzahl pro Einheit
- **Einheiten**: Pauschal pro Einheit
- **Verbrauch**: Zählerbasiert (kWh, m³)
- **Sondernutzung**: Spezielle Zuordnungen

---

## Testfall 1: MEA-Verteilung (Miteigentumsanteile)

**Szenario**: Liegenschaft mit 3 Einheiten nach MEA

**Einheiten**:
| Top | MEA (‰) | Fläche | Erwarteter Anteil |
|-----|---------|--------|-------------------|
| 1 | 100 | 50 m² | 20% |
| 2 | 150 | 75 m² | 30% |
| 3 | 250 | 100 m² | 50% |
| **Gesamt** | **500** | | **100%** |

**Kosten**: 5.000,00 EUR (Liftversicherung)

**Erwartete Verteilung**:
| Top | Kostenanteil |
|-----|--------------|
| 1 | 1.000,00 EUR |
| 2 | 1.500,00 EUR |
| 3 | 2.500,00 EUR |

**Prüfpunkte**:
- [ ] MEA-Summe = 500‰
- [ ] Prozentanteile korrekt
- [ ] Rundung auf Cent

---

## Testfall 2: Flächen-Verteilung (Quadratmeter)

**Szenario**: Versicherung nach Nutzfläche

**Einheiten**:
| Top | Fläche (m²) | Anteil |
|-----|-------------|--------|
| 1 | 50 | 33,33% |
| 2 | 100 | 66,67% |
| **Gesamt** | **150** | **100%** |

**Kosten**: 1.500,00 EUR (Gebäudeversicherung)

**Erwartete Verteilung**:
| Top | Kostenanteil |
|-----|--------------|
| 1 | 500,00 EUR |
| 2 | 1.000,00 EUR |

**Prüfpunkte**:
- [ ] Flächen korrekt aus Einheiten übernommen
- [ ] Anteil nach m² berechnet

---

## Testfall 3: Personen-Verteilung

**Szenario**: Müllabfuhr nach Personenanzahl

**Einheiten**:
| Top | Personen | Anteil |
|-----|----------|--------|
| 1 | 1 | 16,67% |
| 2 | 2 | 33,33% |
| 3 | 3 | 50,00% |
| **Gesamt** | **6** | **100%** |

**Kosten**: 600,00 EUR (Müllabfuhr)

**Erwartete Verteilung**:
| Top | Kostenanteil |
|-----|--------------|
| 1 | 100,00 EUR |
| 2 | 200,00 EUR |
| 3 | 300,00 EUR |

**Prüfpunkte**:
- [ ] Personenanzahl aus Mieter-Daten
- [ ] Aktualisierung bei Mieterwechsel

---

## Testfall 4: Einheiten-Verteilung (Pauschal)

**Szenario**: Pauschalkosten gleichmäßig verteilt

**Einheiten**: 5 Einheiten (unterschiedliche Größen)

**Kosten**: 500,00 EUR (Hausbetreuung pauschal)

**Erwartete Verteilung**:
| Top | Kostenanteil |
|-----|--------------|
| 1 | 100,00 EUR |
| 2 | 100,00 EUR |
| 3 | 100,00 EUR |
| 4 | 100,00 EUR |
| 5 | 100,00 EUR |

**Prüfpunkte**:
- [ ] Alle Einheiten gleich behandelt
- [ ] Unabhängig von Größe/MEA

---

## Testfall 5: Verbrauchs-Verteilung (Heizkosten)

**Szenario**: Heizkosten nach Zählerstand

**Einheiten**:
| Top | Verbrauch (kWh) | Anteil |
|-----|-----------------|--------|
| 1 | 3.000 | 30% |
| 2 | 4.500 | 45% |
| 3 | 2.500 | 25% |
| **Gesamt** | **10.000** | **100%** |

**Kosten**: 4.000,00 EUR (Heizung)

**Erwartete Verteilung**:
| Top | Kostenanteil |
|-----|--------------|
| 1 | 1.200,00 EUR |
| 2 | 1.800,00 EUR |
| 3 | 1.000,00 EUR |

**Prüfpunkte**:
- [ ] Verbrauchsdaten aus Zählerständen
- [ ] Abrechnungszeitraum beachtet

---

## Testfall 6: Gemischte Schlüssel

**Szenario**: Verschiedene Kosten mit unterschiedlichen Schlüsseln

**Kosten und Schlüssel**:
| Kostenart | Betrag | Schlüssel |
|-----------|--------|-----------|
| Versicherung | 1.500,00 EUR | Fläche (QM) |
| Müllabfuhr | 800,00 EUR | Personen |
| Lift | 600,00 EUR | MEA |
| Hausbetreuung | 1.200,00 EUR | Einheiten |

**Prüfpunkte**:
- [ ] Jede Kostenart mit eigenem Schlüssel
- [ ] Summe aller Anteile korrekt
- [ ] Keine Doppelberechnung

---

## Testfall 7: Benutzerdefinierter Schlüssel

**Szenario**: Neuen Verteilerschlüssel anlegen

**Eingabe**:
| Feld | Wert |
|------|------|
| Code | GARTEN |
| Name | Gartennutzung |
| Einheit | Anteil |
| Eingabeart | Direkteingabe |
| MRG-konform | Ja |
| §-Verweis | §21 Abs 1 Z 4 |

**Erwartetes Ergebnis**:
- Schlüssel wird angelegt
- In Auswahl verfügbar
- Bei Abrechnung nutzbar

**Prüfpunkte**:
- [ ] Validierung der Pflichtfelder
- [ ] Eindeutiger Code
- [ ] MRG-Verweis optional

---

## Testfall 8: Leerstand-Behandlung

**Szenario**: Leere Einheit bei Kostenverteilung

**Einheiten**:
| Top | Status | MEA |
|-----|--------|-----|
| 1 | Vermietet | 250 |
| 2 | Leerstand | 250 |
| 3 | Vermietet | 500 |

**Kosten**: 1.000,00 EUR

**Erwartete Verteilung**:
- Top 1: 250,00 EUR (Mieter zahlt)
- Top 2: 250,00 EUR (Eigentümer zahlt)
- Top 3: 500,00 EUR (Mieter zahlt)

**Prüfpunkte**:
- [ ] Leerstand-Anteil beim Eigentümer
- [ ] Badge "Leerstand" angezeigt
- [ ] §21 MRG Hinweis

---

## Browser-Testpfad

1. **Navigation**: Einstellungen → Verteilerschlüssel
2. **Übersicht**: Liste aller Schlüssel anzeigen
3. **Neu anlegen**: "+ Neuer Schlüssel"
4. **Bearbeiten**: Bestehenden Schlüssel ändern
5. **Prüfung in Abrechnung**:
   - Abrechnung → Kosten zuordnen
   - Schlüssel auswählen
   - Verteilung prüfen

---

## Erfolgs-Kriterien

- [ ] Alle 8 Testfälle erfolgreich
- [ ] MEA-Verteilung korrekt
- [ ] Flächen-Verteilung korrekt
- [ ] Personen-Verteilung korrekt
- [ ] Pauschal-Verteilung korrekt
- [ ] Verbrauchs-Verteilung korrekt
- [ ] Benutzerdefinierte Schlüssel funktionieren
- [ ] Leerstand-Kosten beim Eigentümer
