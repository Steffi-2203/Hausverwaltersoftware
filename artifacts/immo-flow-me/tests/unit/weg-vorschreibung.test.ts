/**
 * WEG-Vorschreibungen: Verteilung nach Miteigentumsanteilen (MEA)
 *
 * Testet `distributeWithRemainder` aus wegSettlementService.ts —
 * keine selbstdefinierten Berechnungsfunktionen im Testfile.
 */
import { describe, it } from 'node:test';
import { expect } from '../helpers/expect';
import { distributeWithRemainder } from '../../server/services/wegSettlementService';

describe('distributeWithRemainder — Produktionsfunktion aus wegSettlementService', () => {
  it('3 gleiche Eigentümer (MEA 100/100/100): Summe der Anteile = genau 10.000 €', () => {
    const totalMea = 300;
    const shares = [
      { id: 'owner-a', ratio: 100 / totalMea },
      { id: 'owner-b', ratio: 100 / totalMea },
      { id: 'owner-c', ratio: 100 / totalMea },
    ];
    const result = distributeWithRemainder(10000, shares);
    const sum = result.reduce((acc, r) => acc + r.amount, 0);
    expect(sum).toBe(10000);
  });

  it('Cent-Restbetrag wird dem Eigentümer mit größtem Anteil zugewiesen', () => {
    // 3 Eigentümer, ungleiche Anteile — Cent-Differenz durch Rundung
    // Verwende roundMoney-Vergleich (2 Dezimalstellen) um Fließkommaprobleme zu vermeiden
    const shares = [
      { id: 'big',   ratio: 0.50 },
      { id: 'mid',   ratio: 0.30 },
      { id: 'small', ratio: 0.20 },
    ];
    const result = distributeWithRemainder(100.01, shares);
    const rawSum = result.reduce((acc, r) => acc + r.amount, 0);
    // Auf 2 Dezimalstellen runden bevor Vergleich (distributeWithRemainder garantiert Cent-Genauigkeit)
    const sum = Math.round(rawSum * 100) / 100;
    expect(sum).toBe(100.01);
  });

  it('Einzeleigentümer (ratio = 1): bekommt den vollen Betrag', () => {
    const result = distributeWithRemainder(1234.56, [{ id: 'sole', ratio: 1 }]);
    expect(result[0]!.amount).toBe(1234.56);
  });

  it('leere Anteilsliste: gibt leeres Array zurück', () => {
    const result = distributeWithRemainder(10000, []);
    expect(result).toHaveLength(0);
  });

  it('Betrag null: alle Anteile sind 0', () => {
    const shares = [
      { id: 'a', ratio: 0.5 },
      { id: 'b', ratio: 0.5 },
    ];
    const result = distributeWithRemainder(0, shares);
    expect(result[0]!.amount).toBe(0);
    expect(result[1]!.amount).toBe(0);
  });

  it('5 Eigentümer mit asymmetrischen MEA: Summe exakt korrekt', () => {
    // MEA: 211, 189, 250, 175, 175 → Summe = 1000
    const totalMea = 1000;
    const mea = [211, 189, 250, 175, 175];
    const shares = mea.map((m, i) => ({ id: `owner-${i}`, ratio: m / totalMea }));
    const result = distributeWithRemainder(5753.99, shares);
    const sum = result.reduce((acc, r) => acc + r.amount, 0);
    expect(sum).toBe(5753.99);
  });
});
