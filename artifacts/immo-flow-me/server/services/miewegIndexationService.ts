export type RentType = 'kategoriemiete' | 'richtwertmiete' | 'freier_markt';

export interface IndexationInput {
  currentRent: number;
  inflationRate: number;
  rentType: RentType;
  indexationYear: number;
  lastIndexationDate: Date;
  isEinZweifamilienhaus?: boolean;
}

export interface IndexationResult {
  allowedIncreasePercent: number;
  newRent: number;
  increaseAmount: number;
  explanation: string;
  nextIndexationDate: Date;
  isApplicable: boolean;
  notApplicableReason?: string;
}

export class MieWegIndexationService {
  
  calculateHaelfteRegelung(inflationRate: number): number {
    const baseRate = Math.min(inflationRate, 3);
    const excessRate = Math.max(0, (inflationRate - 3) * 0.5);
    return baseRate + excessRate;
  }

  calculateAllowedIncrease(input: IndexationInput): IndexationResult {
    const { currentRent, inflationRate, rentType, indexationYear, lastIndexationDate, isEinZweifamilienhaus } = input;

    if (isEinZweifamilienhaus) {
      return {
        allowedIncreasePercent: 0,
        newRent: currentRent,
        increaseAmount: 0,
        explanation: 'Das Mieten-Wertsicherungsgesetz (MieWeG) ist auf Ein- und Zweifamilienhäuser nicht anwendbar.',
        nextIndexationDate: this.calculateNextIndexationDate(lastIndexationDate),
        isApplicable: false,
        notApplicableReason: 'Ein- und Zweifamilienhäuser sind vom MieWeG ausgenommen.'
      };
    }

    let allowedIncreasePercent: number;
    let explanation: string;

    if (rentType === 'freier_markt') {
      allowedIncreasePercent = this.calculateHaelfteRegelung(inflationRate);
      explanation = this.getFreierMarktExplanation(inflationRate, allowedIncreasePercent);
    } else {
      const result = this.calculateKategorieRichtwert(inflationRate, indexationYear);
      allowedIncreasePercent = result.percent;
      explanation = result.explanation;
    }

    const increaseAmount = currentRent * (allowedIncreasePercent / 100);
    const newRent = currentRent + increaseAmount;
    const nextIndexationDate = this.calculateNextIndexationDate(lastIndexationDate);

    return {
      allowedIncreasePercent: Math.round(allowedIncreasePercent * 100) / 100,
      newRent: Math.round(newRent * 100) / 100,
      increaseAmount: Math.round(increaseAmount * 100) / 100,
      explanation,
      nextIndexationDate,
      isApplicable: true
    };
  }

  private calculateKategorieRichtwert(inflationRate: number, year: number): { percent: number; explanation: string } {
    if (year === 2026) {
      const allowedPercent = Math.min(inflationRate, 1);
      return {
        percent: allowedPercent,
        explanation: `Für Kategorie- und Richtwertmieten gilt 2026 eine maximale Erhöhung von 1% gemäß MieWeG. ` +
          `Bei einer VPI-Inflation von ${inflationRate.toFixed(2)}% ergibt sich eine zulässige Erhöhung von ${allowedPercent.toFixed(2)}%.`
      };
    }

    if (year === 2027) {
      const allowedPercent = Math.min(inflationRate, 2);
      return {
        percent: allowedPercent,
        explanation: `Für Kategorie- und Richtwertmieten gilt 2027 eine maximale Erhöhung von 2% gemäß MieWeG. ` +
          `Bei einer VPI-Inflation von ${inflationRate.toFixed(2)}% ergibt sich eine zulässige Erhöhung von ${allowedPercent.toFixed(2)}%.`
      };
    }

    const haelftePercent = this.calculateHaelfteRegelung(inflationRate);
    return {
      percent: haelftePercent,
      explanation: this.getHaelfteRegelungExplanation(inflationRate, haelftePercent, 'Kategorie- und Richtwertmieten ab 2028')
    };
  }

  private getFreierMarktExplanation(inflationRate: number, allowedPercent: number): string {
    if (inflationRate <= 3) {
      return `Bei einer VPI-Inflation von ${inflationRate.toFixed(2)}% (≤ 3%) wird die volle Inflation weitergegeben. ` +
        `Zulässige Erhöhung: ${allowedPercent.toFixed(2)}%.`;
    }

    const baseRate = 3;
    const excessInflation = inflationRate - 3;
    const halfExcess = excessInflation * 0.5;

    return `Hälfteregelung angewendet: Bei VPI-Inflation von ${inflationRate.toFixed(2)}% werden die ersten 3% voll ` +
      `und der Überschuss von ${excessInflation.toFixed(2)}% nur zur Hälfte (${halfExcess.toFixed(2)}%) weitergegeben. ` +
      `Formel: min(${inflationRate.toFixed(2)}%, 3%) + max(0, (${inflationRate.toFixed(2)}% - 3%) × 0,5) = ` +
      `${baseRate}% + ${halfExcess.toFixed(2)}% = ${allowedPercent.toFixed(2)}%.`;
  }

  private getHaelfteRegelungExplanation(inflationRate: number, allowedPercent: number, context: string): string {
    if (inflationRate <= 3) {
      return `${context}: Bei einer VPI-Inflation von ${inflationRate.toFixed(2)}% (≤ 3%) ` +
        `gilt die Hälfteregelung, die volle Inflation wird weitergegeben. ` +
        `Zulässige Erhöhung: ${allowedPercent.toFixed(2)}%.`;
    }

    const baseRate = 3;
    const excessInflation = inflationRate - 3;
    const halfExcess = excessInflation * 0.5;

    return `${context}: Hälfteregelung angewendet. Bei VPI-Inflation von ${inflationRate.toFixed(2)}% werden die ersten 3% voll ` +
      `und der Überschuss von ${excessInflation.toFixed(2)}% nur zur Hälfte (${halfExcess.toFixed(2)}%) weitergegeben. ` +
      `Zulässige Erhöhung: ${baseRate}% + ${halfExcess.toFixed(2)}% = ${allowedPercent.toFixed(2)}%.`;
  }

  private calculateNextIndexationDate(lastIndexationDate: Date): Date {
    const nextYear = lastIndexationDate.getFullYear() + 1;
    const nextApril1 = new Date(nextYear, 3, 1);
    
    const oneYearFromLast = new Date(lastIndexationDate);
    oneYearFromLast.setFullYear(oneYearFromLast.getFullYear() + 1);

    if (oneYearFromLast > nextApril1) {
      return new Date(nextYear + 1, 3, 1);
    }

    return nextApril1;
  }

  formatCurrency(amount: number): string {
    return new Intl.NumberFormat('de-AT', {
      style: 'currency',
      currency: 'EUR'
    }).format(amount);
  }

  formatDate(date: Date): string {
    return new Intl.DateTimeFormat('de-AT', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    }).format(date);
  }

  getSummary(result: IndexationResult, currentRent: number): string {
    if (!result.isApplicable) {
      return result.notApplicableReason || 'Indexierung nicht anwendbar.';
    }

    return `Zulässige Mieterhöhung: ${result.allowedIncreasePercent.toFixed(2)}%\n` +
      `Erhöhungsbetrag: ${this.formatCurrency(result.increaseAmount)}\n` +
      `Neue Miete: ${this.formatCurrency(result.newRent)} (von ${this.formatCurrency(currentRent)})\n` +
      `Nächster möglicher Indexierungstermin: ${this.formatDate(result.nextIndexationDate)}`;
  }
}

export const miewegIndexationService = new MieWegIndexationService();
