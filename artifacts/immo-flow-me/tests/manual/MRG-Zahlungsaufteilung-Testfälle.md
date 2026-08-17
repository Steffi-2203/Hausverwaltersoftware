# MRG-Zahlungsaufteilung - Manuelle Testfälle

## Rechtsgrundlage

Die Zahlungsaufteilung folgt dem MRG (Mietrechtsgesetz) Prinzip:
- **Priorität**: BK (Betriebskosten) → HK (Heizkosten) → Miete
- Eingehende Zahlungen werden zuerst auf BK angerechnet, dann auf HK, zuletzt auf Miete
- Dies schützt den Mieter vor ungerechtfertigten BK-Rückständen

---

## Testfall 1: Vollständige Zahlung

**Szenario**: Mieter in Wien-Favoriten, 70m² Altbauwohnung

| Kategorie | SOLL-Betrag |
|-----------|-------------|
| Betriebskosten | 180,50 EUR |
| Heizkosten | 95,30 EUR |
| Grundmiete | 650,00 EUR |
| **Gesamt** | **925,80 EUR** |

**Eingabe**: Zahlung von 925,80 EUR

**Erwartetes Ergebnis**:
- IST-BK: 180,50 EUR (100% gedeckt)
- IST-HK: 95,30 EUR (100% gedeckt)
- IST-Miete: 650,00 EUR (100% gedeckt)
- Saldo: 0,00 EUR
- Status: "vollständig"

**Prüfpunkte**:
- [ ] Alle Werte werden korrekt angezeigt
- [ ] Status-Badge zeigt "Vollständig" in Grün
- [ ] Keine Mahnung generiert

---

## Testfall 2: Teilzahlung - BK-Priorität

**Szenario**: Mieter zahlt nur 200 EUR statt 750 EUR

| Kategorie | SOLL-Betrag |
|-----------|-------------|
| Betriebskosten | 150,00 EUR |
| Heizkosten | 100,00 EUR |
| Grundmiete | 500,00 EUR |
| **Gesamt** | **750,00 EUR** |

**Eingabe**: Zahlung von 200,00 EUR

**Erwartetes Ergebnis (MRG-konform)**:
- IST-BK: 150,00 EUR (100% gedeckt)
- IST-HK: 50,00 EUR (50% gedeckt)
- IST-Miete: 0,00 EUR (0% gedeckt)
- Unterzahlung: 550,00 EUR
- Status: "teilbezahlt"

**Prüfpunkte**:
- [ ] BK wird zuerst vollständig gedeckt
- [ ] Restbetrag geht auf HK
- [ ] Miete bleibt bei 0 EUR
- [ ] Saldo zeigt 550 EUR offen

---

## Testfall 3: Überzahlung

**Szenario**: Mieter zahlt mehr als geschuldet

| Kategorie | SOLL-Betrag |
|-----------|-------------|
| Betriebskosten | 150,00 EUR |
| Heizkosten | 100,00 EUR |
| Grundmiete | 500,00 EUR |
| **Gesamt** | **750,00 EUR** |

**Eingabe**: Zahlung von 800,00 EUR

**Erwartetes Ergebnis**:
- IST-BK: 150,00 EUR
- IST-HK: 100,00 EUR
- IST-Miete: 500,00 EUR
- Überzahlung: 50,00 EUR
- Status: "überzahlt"
- Saldo: -50,00 EUR (Guthaben)

**Prüfpunkte**:
- [ ] Überzahlung wird korrekt angezeigt
- [ ] Status-Badge zeigt "Überzahlt" 
- [ ] Negative Saldo-Anzeige (Guthaben)

---

## Testfall 4: Gewerbeeinheit mit höherer USt

**Szenario**: Bürofläche mit 20% USt auf Heizkosten

| Kategorie | Netto | USt | Brutto |
|-----------|-------|-----|--------|
| Betriebskosten | 250,00 EUR | 10% | 275,00 EUR |
| Heizkosten | 200,00 EUR | 20% | 240,00 EUR |
| Grundmiete | 1.000,00 EUR | 20% | 1.200,00 EUR |
| **Gesamt** | | | **1.715,00 EUR** |

**Eingabe**: Zahlung von 1.500,00 EUR

**Erwartetes Ergebnis**:
- IST-BK: 275,00 EUR (100%)
- IST-HK: 240,00 EUR (100%)
- IST-Miete: 985,00 EUR (82%)
- Unterzahlung: 215,00 EUR

**Prüfpunkte**:
- [ ] USt-Beträge werden berücksichtigt
- [ ] Miete wird anteilig reduziert

---

## Testfall 5: Mahnstatus-Eskalation

**Szenario**: Prüfung der Mahnstufen nach Tagen überfällig

| Tage überfällig | Erwarteter Mahnstatus |
|-----------------|----------------------|
| 0 | "aktuell" |
| 1-14 | "Zahlungserinnerung" |
| 15-30 | "1. Mahnung" |
| > 30 | "2. Mahnung" |

**Prüfpunkte**:
- [ ] Richtige Mahnstufe wird angezeigt
- [ ] Badge-Farbe entspricht Stufe (grau → gelb → orange → rot)

---

## Testfall 6: Keine Zahlung

**Szenario**: Mieter hat nicht bezahlt

| Kategorie | SOLL-Betrag |
|-----------|-------------|
| Betriebskosten | 180,00 EUR |
| Heizkosten | 120,00 EUR |
| Grundmiete | 700,00 EUR |
| **Gesamt** | **1.000,00 EUR** |

**Eingabe**: Zahlung von 0,00 EUR

**Erwartetes Ergebnis**:
- IST-BK: 0,00 EUR
- IST-HK: 0,00 EUR
- IST-Miete: 0,00 EUR
- Unterzahlung: 1.000,00 EUR
- Status: "offen"

**Prüfpunkte**:
- [ ] Status "offen" wird angezeigt
- [ ] Mahnung kann generiert werden
- [ ] Alle Differenzen werden rot markiert

---

## Testfall 7: Rundungsdifferenzen

**Szenario**: Mieter zahlt gerundeten Betrag

| SOLL | IST (gerundet) | Differenz |
|------|----------------|-----------|
| 925,80 EUR | 926,00 EUR | +0,20 EUR |
| 925,80 EUR | 925,00 EUR | -0,80 EUR |
| 925,80 EUR | 930,00 EUR | +4,20 EUR |

**Prüfpunkte**:
- [ ] Kleine Überzahlungen werden als Guthaben gebucht
- [ ] Kleine Unterzahlungen werden korrekt als offen markiert
- [ ] Keine Rundungsfehler bei Cent-Beträgen

---

## Browser-Testpfad

1. **Navigation**: Dashboard → Zahlungen
2. **Filter**: Liegenschaft auswählen, Monat auswählen
3. **Ansicht**: SOLL/IST-Übersicht öffnen
4. **Prüfung**: 
   - Tabelle zeigt alle Mieter mit korrekten Werten
   - Summenzeile stimmt
   - Export-Button funktioniert

---

## Erfolgs-Kriterien

- [ ] Alle 7 Testfälle bestanden
- [ ] BK→HK→Miete Priorität wird eingehalten
- [ ] Korrekte Mahnstatus-Berechnung
- [ ] Korrekte Rundung auf 2 Dezimalstellen
- [ ] Export nach PDF/Excel funktioniert
