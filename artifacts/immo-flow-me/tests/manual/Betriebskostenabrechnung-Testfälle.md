# Betriebskostenabrechnung (§21 MRG) - Manuelle Testfälle

## Rechtsgrundlage

Gemäß **§21 MRG** (Mietrechtsgesetz) gelten folgende Regeln:
- Abrechnungszeitraum: Kalenderjahr (01.01. bis 31.12.)
- Frist: Abrechnung muss bis 30.06. des Folgejahres erfolgen (§21 Abs 3)
- Verjährung: Ansprüche erlöschen am 01.01. des 4. Folgejahres (§21 Abs 4)
- Leerstand: Kosten trägt der Eigentümer
- BK sind Durchlaufposten (pass-through)

---

## Testfall 1: Standard-Abrechnung mit 3 Einheiten

**Szenario**: Mehrfamilienhaus mit 3 vollvermieteten Wohnungen

| Einheit | Fläche (m²) | MEA | Mieter |
|---------|-------------|-----|--------|
| Top 1 | 50 | 100 | Müller |
| Top 2 | 75 | 150 | Schmidt |
| Top 3 | 100 | 250 | Weber |
| **Gesamt** | **225** | **500** | |

**Kosten**:
| Kategorie | Betrag | Verteilerschlüssel |
|-----------|--------|-------------------|
| Versicherung | 1.500,00 EUR | Fläche (QM) |
| Müllabfuhr | 800,00 EUR | Personen |
| Lift | 600,00 EUR | MEA |
| Hausbetreuung | 1.200,00 EUR | Fläche (QM) |
| **Gesamt** | **4.100,00 EUR** | |

**Erwartete Verteilung (MEA)**:
| Einheit | Anteil | Kosten |
|---------|--------|--------|
| Top 1 | 20% | 820,00 EUR |
| Top 2 | 30% | 1.230,00 EUR |
| Top 3 | 50% | 2.050,00 EUR |

**Prüfpunkte**:
- [ ] Gesamtkosten stimmen
- [ ] Verteilung nach MEA korrekt
- [ ] Alle Mieter erhalten Abrechnung
- [ ] PDF-Export funktioniert

---

## Testfall 2: Leerstand - §21 MRG Eigentümer-Kosten

**Szenario**: 4 Einheiten, davon 1 leerstand

| Einheit | Fläche | MEA | Status |
|---------|--------|-----|--------|
| Top 1 | 60 | 120 | Vermietet (aktuell + Jahresmieter) |
| Top 2 | 60 | 120 | Leerstand |
| Top 3 | 60 | 120 | Vermietet (aktuell + Jahresmieter) |
| Top 4 | 60 | 120 | Vermietet (nur Jahresmieter - ausgezogen) |

**Kosten**: 4.800,00 EUR (gesamt)

**Erwartete Verteilung**:
| Einheit | Anteil | BK-Kosten | Zahler |
|---------|--------|-----------|--------|
| Top 1 | 25% | 1.200,00 EUR | Mieter |
| Top 2 | 25% | 1.200,00 EUR | **Eigentümer** |
| Top 3 | 25% | 1.200,00 EUR | Mieter |
| Top 4 | 25% | 1.200,00 EUR | Altmieter (HK) / Eigentümer (BK) |

**Prüfpunkte**:
- [ ] Leerstandskosten werden Eigentümer zugeordnet
- [ ] Badge "Leerstand" wird angezeigt
- [ ] Eigentümer-Anteil wird in Zusammenfassung gezeigt
- [ ] Altmieter bekommt nur HK-Abrechnung

---

## Testfall 3: Mieterwechsel im Abrechnungsjahr

**Szenario**: Mieter wechselt am 01.07.

| Zeitraum | Mieter | BK-Vorschuss/Monat |
|----------|--------|-------------------|
| Jan-Jun | Altmieter (Huber) | 120,00 EUR |
| Jul-Dez | Neumieter (Schmidt) | 140,00 EUR |

**Jahreskosten**: 1.800,00 EUR BK, 1.200,00 EUR HK

**Erwartung**:
- **BK**: Aktueller Mieter (Schmidt) zahlt Nachzahlung/Guthaben
- **HK**: Jahresmieter (Huber) zahlt Nachzahlung/Guthaben

**Prüfpunkte**:
- [ ] Korrekte Zuordnung BK → aktueller Mieter
- [ ] Korrekte Zuordnung HK → Altmieter
- [ ] Beide erhalten separate Abrechnungen
- [ ] Saldi korrekt berechnet

---

## Testfall 4: Vorschuss-Anpassung nach Abrechnung

**Szenario**: Nach BK-Abrechnung werden neue Vorschüsse berechnet

**Formel (MRG-konform)**: `(BK + HK) / 12 × 1,03` (3% Sicherheitsreserve)

| Aktuelle Werte | Neu (nach Abrechnung) |
|----------------|----------------------|
| BK-Vorschuss: 120,00 EUR | (1.800 + 1.200) / 12 × 1,03 = 257,50 EUR |
| HK-Vorschuss: 80,00 EUR | |
| **Gesamt: 200,00 EUR** | **BK: 154,50 EUR + HK: 103,00 EUR** |

**Prüfpunkte**:
- [ ] Dialog "Neue Vorschüsse" öffnet
- [ ] Berechnung mit 3% Reserve korrekt
- [ ] Änderungen können übernommen werden
- [ ] PDF-Brief wird generiert

---

## Testfall 5: Fristen-Warnungen

**Szenario**: Prüfung der §21 MRG Fristen

| Abrechnungsjahr | Frist §21 Abs 3 | Verjährung §21 Abs 4 |
|-----------------|-----------------|---------------------|
| 2024 | 30.06.2025 | 01.01.2028 |
| 2023 | 30.06.2024 | 01.01.2027 |
| 2022 | 30.06.2023 | 01.01.2026 |

**Prüfpunkte**:
- [ ] Warnung wird angezeigt wenn nach 30.06.
- [ ] Verjährungswarnung wenn nahe 01.01. des 4. Jahres
- [ ] Farbcodierung: Gelb (nähert sich), Rot (überschritten)

---

## Testfall 6: Heizkosten separat nach Verbrauch

**Szenario**: HK-Abrechnung mit Verbrauchszählern

| Einheit | HK-Vorschuss/Monat | Verbrauch (kWh) | Anteil |
|---------|-------------------|-----------------|--------|
| Top 1 | 80,00 EUR | 3.000 | 30% |
| Top 2 | 100,00 EUR | 4.500 | 45% |
| Top 3 | 60,00 EUR | 2.500 | 25% |
| **Gesamt** | | **10.000** | |

**Gesamte HK**: 4.000,00 EUR

**Erwartete Verteilung**:
| Einheit | Kostenanteil | Vorschuss (12 Mon) | Saldo |
|---------|--------------|-------------------|-------|
| Top 1 | 1.200,00 EUR | 960,00 EUR | +240,00 EUR (Nachzahlung) |
| Top 2 | 1.800,00 EUR | 1.200,00 EUR | +600,00 EUR (Nachzahlung) |
| Top 3 | 1.000,00 EUR | 720,00 EUR | +280,00 EUR (Nachzahlung) |

**Prüfpunkte**:
- [ ] HK werden nach Verbrauch verteilt
- [ ] Vorschüsse korrekt berücksichtigt
- [ ] Saldi stimmen

---

## Testfall 7: Gemischte Nutzung (Wohn + Gewerbe)

**Szenario**: Wohnungen mit 10% USt, Gewerbe mit 20% USt auf HK

| Einheit | Typ | HK-Vorschuss | USt-Satz |
|---------|-----|--------------|---------|
| Top 1-3 | Wohnung | 100,00 EUR | 10% |
| Top 4 | Büro | 200,00 EUR | 20% |

**Prüfpunkte**:
- [ ] Korrekte USt-Sätze werden angewendet
- [ ] Netto/Brutto-Beträge korrekt
- [ ] Separate Ausweise für Gewerbe

---

## Browser-Testpfad

1. **Navigation**: Dashboard → Abrechnung
2. **Auswahl**: Liegenschaft und Jahr wählen
3. **Prüfung**:
   - Kostenübersicht vollständig
   - Einheiten-Tabelle mit Anteilen
   - Leerstand korrekt markiert
4. **Export**: PDF erstellen und prüfen
5. **Vorschuss-Anpassung**: Dialog öffnen und testen

---

## Erfolgs-Kriterien

- [ ] Alle 7 Testfälle erfolgreich
- [ ] Verteilerschlüssel korrekt angewendet
- [ ] Leerstandskosten beim Eigentümer
- [ ] §21 MRG Fristen werden gewarnt
- [ ] USt-Sätze korrekt (10%/20%)
- [ ] PDF-Export MRG-konform
- [ ] Vorschuss-Berechnung mit 3% Reserve
