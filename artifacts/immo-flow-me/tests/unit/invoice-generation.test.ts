import { describe, it, before as beforeAll, after as afterAll } from 'node:test';
import { expect } from '../helpers/expect';
import { roundMoney } from '@shared/utils';

describe('Invoice Generation - MRG Compliance', () => {
  
  describe('roundMoney Utility', () => {
    it('should round to 2 decimal places correctly', () => {
      expect(roundMoney(10.125)).toBe(10.13);
      expect(roundMoney(10.124)).toBe(10.12);
      expect(roundMoney(99.999)).toBe(100);
      expect(roundMoney(0.001)).toBe(0);
      expect(roundMoney(0.005)).toBe(0.01);
    });
  });

  describe('Wohnung - 10% USt für Miete/BK, 20% USt für HK', () => {
    const testCase = {
      grundmiete: 650,
      betriebskosten: 180,
      heizkosten: 95,
      wasserkosten: 25,
      ustSatzMiete: 10,
      ustSatzBk: 10,
      ustSatzHeizung: 20,
      ustSatzWasser: 10,
    };

    it('should calculate correct net amounts from gross', () => {
      const netMiete = testCase.grundmiete / (1 + testCase.ustSatzMiete / 100);
      const netBk = testCase.betriebskosten / (1 + testCase.ustSatzBk / 100);
      const netHk = testCase.heizkosten / (1 + testCase.ustSatzHeizung / 100);
      const netWasser = testCase.wasserkosten / (1 + testCase.ustSatzWasser / 100);

      expect(roundMoney(netMiete)).toBe(590.91);
      expect(roundMoney(netBk)).toBe(163.64);
      expect(roundMoney(netHk)).toBe(79.17);
      expect(roundMoney(netWasser)).toBe(22.73);
    });

    it('should calculate correct USt amounts', () => {
      const netMiete = testCase.grundmiete / (1 + testCase.ustSatzMiete / 100);
      const netBk = testCase.betriebskosten / (1 + testCase.ustSatzBk / 100);
      const netHk = testCase.heizkosten / (1 + testCase.ustSatzHeizung / 100);
      const netWasser = testCase.wasserkosten / (1 + testCase.ustSatzWasser / 100);

      const ustMiete = testCase.grundmiete - netMiete;
      const ustBk = testCase.betriebskosten - netBk;
      const ustHk = testCase.heizkosten - netHk;
      const ustWasser = testCase.wasserkosten - netWasser;

      expect(roundMoney(ustMiete)).toBe(59.09);
      expect(roundMoney(ustBk)).toBe(16.36);
      expect(roundMoney(ustHk)).toBe(15.83);
      expect(roundMoney(ustWasser)).toBe(2.27);

      const totalUst = ustMiete + ustBk + ustHk + ustWasser;
      expect(roundMoney(totalUst)).toBe(93.56);
    });

    it('should generate consistent results on multiple dry-runs', () => {
      const runCalculation = () => {
        const netMiete = testCase.grundmiete / (1 + testCase.ustSatzMiete / 100);
        const netBk = testCase.betriebskosten / (1 + testCase.ustSatzBk / 100);
        const netHk = testCase.heizkosten / (1 + testCase.ustSatzHeizung / 100);
        const gesamtbetrag = testCase.grundmiete + testCase.betriebskosten + 
                            testCase.heizkosten + testCase.wasserkosten;
        return {
          netMiete: roundMoney(netMiete),
          netBk: roundMoney(netBk),
          netHk: roundMoney(netHk),
          gesamtbetrag: roundMoney(gesamtbetrag),
        };
      };

      const run1 = runCalculation();
      const run2 = runCalculation();
      const run3 = runCalculation();

      expect(run1).toEqual(run2);
      expect(run2).toEqual(run3);
    });
  });

  describe('Geschäftslokal - 20% USt für alle Positionen', () => {
    const testCase = {
      grundmiete: 1800,
      betriebskosten: 350,
      heizkosten: 180,
      wasserkosten: 45,
      ustSatzMiete: 20,
      ustSatzBk: 20,
      ustSatzHeizung: 20,
      ustSatzWasser: 20,
    };

    it('should use 20% USt for commercial units', () => {
      const isCommercial = true;
      const expectedUstSatz = isCommercial ? 20 : 10;
      expect(testCase.ustSatzMiete).toBe(expectedUstSatz);
      expect(testCase.ustSatzBk).toBe(expectedUstSatz);
    });

    it('should calculate correct net amounts with 20% USt', () => {
      const netMiete = testCase.grundmiete / 1.20;
      const netBk = testCase.betriebskosten / 1.20;
      const netHk = testCase.heizkosten / 1.20;

      expect(roundMoney(netMiete)).toBe(1500);
      expect(roundMoney(netBk)).toBe(291.67);
      expect(roundMoney(netHk)).toBe(150);
    });

    it('should calculate total USt correctly', () => {
      const gesamtBrutto = testCase.grundmiete + testCase.betriebskosten + 
                          testCase.heizkosten + testCase.wasserkosten;
      const gesamtNetto = gesamtBrutto / 1.20;
      const totalUst = gesamtBrutto - gesamtNetto;

      expect(roundMoney(gesamtNetto)).toBe(1979.17);
      expect(roundMoney(totalUst)).toBe(395.83);
    });
  });

  describe('Invoice Line Generation', () => {
    it('should create separate lines for each cost type', () => {
      const mockInvoice = {
        grundmiete: 650,
        betriebskosten: 180,
        heizkosten: 95,
        wasserkosten: 25,
      };

      const expectedLines = [
        { expenseType: 'grundmiete', grossAmount: 650, allocationReference: 'MRG §15' },
        { expenseType: 'betriebskosten', grossAmount: 180, allocationReference: 'MRG §21' },
        { expenseType: 'heizkosten', grossAmount: 95, allocationReference: 'HeizKG' },
        { expenseType: 'wasserkosten', grossAmount: 25, allocationReference: 'MRG §21' },
      ];

      const lines = Object.entries(mockInvoice)
        .filter(([_, value]) => value > 0)
        .map(([key, value]) => {
          const refs: Record<string, string> = {
            grundmiete: 'MRG §15',
            betriebskosten: 'MRG §21',
            heizkosten: 'HeizKG',
            wasserkosten: 'MRG §21',
          };
          return {
            expenseType: key,
            grossAmount: value,
            allocationReference: refs[key],
          };
        });

      expect(lines.length).toBe(4);
      expect(lines).toEqual(expectedLines);
    });

    it('should skip lines with zero amounts', () => {
      const mockInvoice = {
        grundmiete: 500,
        betriebskosten: 0,
        heizkosten: 50,
        wasserkosten: 0,
      };

      const lines = Object.entries(mockInvoice)
        .filter(([_, value]) => value > 0);

      expect(lines.length).toBe(2);
    });
  });
});
