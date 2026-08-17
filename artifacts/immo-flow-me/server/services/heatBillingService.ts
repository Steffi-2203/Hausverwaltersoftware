export interface HeatBillingInput {
  runId: number;
  propertyId: string;
  periodFrom: string;
  periodTo: string;
  totalCosts: {
    heatingSupply: number;
    hotWaterSupply: number;
    maintenance: number;
    meterReadingCost: number;
  };
  config: {
    heatingConsumptionSharePct: number;
    heatingAreaSharePct: number;
    hotWaterConsumptionSharePct: number;
    hotWaterAreaSharePct: number;
    roundingMethod: 'kaufmaennisch';
    restCentRule: 'assign_to_largest_share' | 'assign_to_smallest_share';
  };
  units: Array<{
    unitId: string;
    areaM2: number;
    mea?: number;
    occupancy?: number;
    heatingMeter?: { type: 'hkv' | 'waermemengenzaehler'; value: number } | null;
    hotWaterMeter?: { value: number } | null;
    prepayment: number;
  }>;
}

export interface ComplianceCheck {
  paragraph: string;
  requirement: string;
  status: 'ok' | 'warnung' | 'fehler';
  details: string;
}

export interface ComplianceCheckResult {
  passed: boolean;
  checks: ComplianceCheck[];
}

export interface PlausibilityFlag {
  unitId: string;
  type: string;
  message: string;
}

export interface PlausibilityReport {
  passed: boolean;
  flags: PlausibilityFlag[];
}

export interface HeatBillingLineResult {
  unitId: string;
  tenantName?: string;
  areaM2: number;
  mea?: number;
  occupancy: number;
  heatingMeterType?: 'hkv' | 'waermemengenzaehler' | null;
  heatingMeterValue?: number | null;
  heatingMeterMissing: boolean;
  hotWaterMeterValue?: number | null;
  hotWaterMeterMissing: boolean;
  heatingConsumptionShare: number;
  heatingAreaShare: number;
  heatingTotal: number;
  hotWaterConsumptionShare: number;
  hotWaterAreaShare: number;
  hotWaterTotal: number;
  maintenanceShare: number;
  meterReadingShare: number;
  totalCost: number;
  prepayment: number;
  balance: number;
  isEstimated: boolean;
  estimationReason?: string;
  plausibilityFlags: PlausibilityFlag[];
}

export interface HeatBillingSummary {
  totalHeatingDistributed: number;
  totalHotWaterDistributed: number;
  totalMaintenanceDistributed: number;
  totalMeterReadingDistributed: number;
  totalDistributed: number;
  totalCosts: number;
  trialBalanceDiff: number;
  trialBalanceOk: boolean;
}

export interface HeatBillingResult {
  lines: HeatBillingLineResult[];
  summary: HeatBillingSummary;
  warnings: string[];
  complianceCheck: ComplianceCheckResult;
  plausibilityReport: PlausibilityReport;
}

import { toCents, fromCents, shareOfCents, sumCents } from "../lib/money";

export class HeatBillingService {
  /**
   * Kaufmännische Rundung auf 2 Nachkommastellen — float-sicher über Integer-Cents.
   * (Die frühere Variante `Math.round(v*100)/100` rundete z. B. 1.005 auf 1.00
   * statt 1.01 und Negativwerte nicht kaufmännisch.)
   */
  private round2(value: number): number {
    return fromCents(toCents(value));
  }

  private median(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      return (sorted[mid - 1]! + sorted[mid]!) / 2;
    }
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return sorted[mid]!;
  }

  compute(input: HeatBillingInput): HeatBillingResult {
    const warnings: string[] = [];
    const allPlausibilityFlags: PlausibilityFlag[] = [];

    const totalArea = input.units.reduce((sum, u) => sum + u.areaM2, 0);
    const unitCount = input.units.length;

    const heatingConsumptionPool = input.totalCosts.heatingSupply * (input.config.heatingConsumptionSharePct / 100);
    const heatingAreaPool = input.totalCosts.heatingSupply * (input.config.heatingAreaSharePct / 100);
    const hotWaterConsumptionPool = input.totalCosts.hotWaterSupply * (input.config.hotWaterConsumptionSharePct / 100);
    const hotWaterAreaPool = input.totalCosts.hotWaterSupply * (input.config.hotWaterAreaSharePct / 100);

    const unitsWithHeatingMeter = input.units.filter(u => u.heatingMeter && u.heatingMeter.value > 0);
    const unitsWithoutHeatingMeter = input.units.filter(u => !u.heatingMeter || u.heatingMeter.value <= 0);
    const totalHeatingConsumption = unitsWithHeatingMeter.reduce((sum, u) => sum + (u.heatingMeter?.value ?? 0), 0);

    const unitsWithHotWaterMeter = input.units.filter(u => u.hotWaterMeter && u.hotWaterMeter.value > 0);
    const unitsWithoutHotWaterMeter = input.units.filter(u => !u.hotWaterMeter || u.hotWaterMeter.value <= 0);
    const totalHotWaterConsumption = unitsWithHotWaterMeter.reduce((sum, u) => sum + (u.hotWaterMeter?.value ?? 0), 0);

    for (const u of unitsWithoutHeatingMeter) {
      warnings.push(`Einheit ${u.unitId}: Keine Heizungs-Messdaten – Ersatzverteilung nach Fläche gemäß §12 HeizKG`);
    }
    for (const u of unitsWithoutHotWaterMeter) {
      if (input.totalCosts.hotWaterSupply > 0) {
        warnings.push(`Einheit ${u.unitId}: Keine Warmwasser-Messdaten – Ersatzverteilung nach Fläche gemäß §12 HeizKG`);
      }
    }

    const heatingMeterValues = unitsWithHeatingMeter.map(u => u.heatingMeter!.value);
    const heatingMedian = this.median(heatingMeterValues);
    const hotWaterMeterValues = unitsWithHotWaterMeter.map(u => u.hotWaterMeter!.value);
    const hotWaterMedian = this.median(hotWaterMeterValues);

    const lines: HeatBillingLineResult[] = input.units.map(unit => {
      const areaRatio = totalArea > 0 ? unit.areaM2 / totalArea : 0;
      let isEstimated = false;
      let estimationReason: string | undefined;
      const unitFlags: PlausibilityFlag[] = [];

      let heatingConsumptionShare: number;
      let heatingMeterMissing = false;
      if (!unit.heatingMeter || unit.heatingMeter.value <= 0) {
        heatingConsumptionShare = this.round2(heatingConsumptionPool * areaRatio);
        heatingMeterMissing = true;
        isEstimated = true;
        estimationReason = "Keine Messdaten vorhanden – Ersatzverteilung nach Fläche gemäß §12 HeizKG";
      } else {
        const consumptionRatio = totalHeatingConsumption > 0 ? unit.heatingMeter.value / totalHeatingConsumption : 0;
        heatingConsumptionShare = this.round2(heatingConsumptionPool * consumptionRatio);

        if (heatingMedian > 0) {
          if (unit.heatingMeter.value > heatingMedian * 3) {
            unitFlags.push({ unitId: unit.unitId, type: 'heizung_hoch', message: `Heizverbrauch ${unit.heatingMeter.value} liegt über dem 3-fachen des Medians (${heatingMedian.toFixed(2)})` });
          }
          if (unit.heatingMeter.value < heatingMedian * 0.1) {
            unitFlags.push({ unitId: unit.unitId, type: 'heizung_niedrig', message: `Heizverbrauch ${unit.heatingMeter.value} liegt unter 10% des Medians (${heatingMedian.toFixed(2)})` });
          }
        }
      }

      const heatingAreaShare = this.round2(heatingAreaPool * areaRatio);
      const heatingTotal = this.round2(heatingConsumptionShare + heatingAreaShare);

      let hotWaterConsumptionShare: number;
      let hotWaterMeterMissing = false;
      if (!unit.hotWaterMeter || unit.hotWaterMeter.value <= 0) {
        hotWaterConsumptionShare = this.round2(hotWaterConsumptionPool * areaRatio);
        hotWaterMeterMissing = true;
        if (input.totalCosts.hotWaterSupply > 0) {
          isEstimated = true;
          estimationReason = estimationReason || "Keine Messdaten vorhanden – Ersatzverteilung nach Fläche gemäß §12 HeizKG";
        }
      } else {
        const consumptionRatio = totalHotWaterConsumption > 0 ? unit.hotWaterMeter.value / totalHotWaterConsumption : 0;
        hotWaterConsumptionShare = this.round2(hotWaterConsumptionPool * consumptionRatio);

        if (hotWaterMedian > 0) {
          if (unit.hotWaterMeter.value > hotWaterMedian * 3) {
            unitFlags.push({ unitId: unit.unitId, type: 'warmwasser_hoch', message: `Warmwasserverbrauch ${unit.hotWaterMeter.value} liegt über dem 3-fachen des Medians (${hotWaterMedian.toFixed(2)})` });
          }
          if (unit.hotWaterMeter.value < hotWaterMedian * 0.1) {
            unitFlags.push({ unitId: unit.unitId, type: 'warmwasser_niedrig', message: `Warmwasserverbrauch ${unit.hotWaterMeter.value} liegt unter 10% des Medians (${hotWaterMedian.toFixed(2)})` });
          }
        }
      }

      const hotWaterAreaShare = this.round2(hotWaterAreaPool * areaRatio);
      const hotWaterTotal = this.round2(hotWaterConsumptionShare + hotWaterAreaShare);

      const maintenanceShare = this.round2(input.totalCosts.maintenance * areaRatio);
      const meterReadingShare = this.round2(input.totalCosts.meterReadingCost / unitCount);

      const totalCost = this.round2(heatingTotal + hotWaterTotal + maintenanceShare + meterReadingShare);
      const balance = this.round2(totalCost - unit.prepayment);

      allPlausibilityFlags.push(...unitFlags);

      return {
        unitId: unit.unitId,
        areaM2: unit.areaM2,
        mea: unit.mea,
        occupancy: unit.occupancy ?? 1,
        heatingMeterType: unit.heatingMeter?.type ?? null,
        heatingMeterValue: unit.heatingMeter?.value ?? null,
        heatingMeterMissing,
        hotWaterMeterValue: unit.hotWaterMeter?.value ?? null,
        hotWaterMeterMissing,
        heatingConsumptionShare,
        heatingAreaShare,
        heatingTotal,
        hotWaterConsumptionShare,
        hotWaterAreaShare,
        hotWaterTotal,
        maintenanceShare,
        meterReadingShare,
        totalCost,
        prepayment: unit.prepayment,
        balance,
        isEstimated,
        estimationReason,
        plausibilityFlags: unitFlags,
      };
    });

    // Summen exakt in Integer-Cents bilden (keine Float-Drift bei vielen Positionen)
    const heatingSupplyCents    = toCents(input.totalCosts.heatingSupply);
    const hotWaterSupplyCents   = toCents(input.totalCosts.hotWaterSupply);
    const maintenanceCents      = toCents(input.totalCosts.maintenance);
    const meterReadingCents     = toCents(input.totalCosts.meterReadingCost);
    const totalCostsCents = sumCents([heatingSupplyCents, hotWaterSupplyCents, maintenanceCents, meterReadingCents]);
    const totalCosts = fromCents(totalCostsCents);

    let totalHeatingDistributed    = fromCents(sumCents(lines.map(l => toCents(l.heatingTotal))));
    let totalHotWaterDistributed   = fromCents(sumCents(lines.map(l => toCents(l.hotWaterTotal))));
    let totalMaintenanceDistributed    = fromCents(sumCents(lines.map(l => toCents(l.maintenanceShare))));
    let totalMeterReadingDistributed   = fromCents(sumCents(lines.map(l => toCents(l.meterReadingShare))));
    let totalDistributed = fromCents(sumCents(lines.map(l => toCents(l.totalCost))));

    // Restcent-Korrektur PER KOSTENKOMPONENTE — verhindert, dass ein
    // Warmwasser-Rundungscent fälschlicherweise als Heizkosten ausgewiesen wird.
    if (lines.length > 0) {
      // Zieldzeile (größter oder kleinster Gesamtanteil)
      const targetIdx = input.config.restCentRule === 'assign_to_smallest_share'
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        ? lines.reduce((minIdx, line, idx) => line.totalCost < lines[minIdx]!.totalCost ? idx : minIdx, 0)
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        : lines.reduce((maxIdx, line, idx) => line.totalCost > lines[maxIdx]!.totalCost ? idx : maxIdx, 0);
      const targetLine = lines[targetIdx]!;

      // Je Kostenpool Rundungsdifferenz berechnen und in die richtige Komponente buchen
      const heatingRestcents    = heatingSupplyCents  - sumCents(lines.map(l => toCents(l.heatingTotal)));
      const hotWaterRestcents   = hotWaterSupplyCents  - sumCents(lines.map(l => toCents(l.hotWaterTotal)));
      const maintRestcents      = maintenanceCents     - sumCents(lines.map(l => toCents(l.maintenanceShare)));
      const meterRestcents      = meterReadingCents    - sumCents(lines.map(l => toCents(l.meterReadingShare)));

      if (heatingRestcents !== 0) {
        // Heizkosten-Restcent → heatingConsumptionShare (Verbrauchsanteil trägt Restcent)
        targetLine.heatingConsumptionShare = this.round2(targetLine.heatingConsumptionShare + fromCents(heatingRestcents));
        targetLine.heatingTotal = this.round2(targetLine.heatingConsumptionShare + targetLine.heatingAreaShare);
        totalHeatingDistributed = this.round2(totalHeatingDistributed + fromCents(heatingRestcents));
      }
      if (hotWaterRestcents !== 0) {
        // Warmwasser-Restcent → hotWaterConsumptionShare (nicht heatingConsumptionShare!)
        targetLine.hotWaterConsumptionShare = this.round2(targetLine.hotWaterConsumptionShare + fromCents(hotWaterRestcents));
        targetLine.hotWaterTotal = this.round2(targetLine.hotWaterConsumptionShare + targetLine.hotWaterAreaShare);
        totalHotWaterDistributed = this.round2(totalHotWaterDistributed + fromCents(hotWaterRestcents));
      }
      if (maintRestcents !== 0) {
        targetLine.maintenanceShare = this.round2(targetLine.maintenanceShare + fromCents(maintRestcents));
        totalMaintenanceDistributed = this.round2(totalMaintenanceDistributed + fromCents(maintRestcents));
      }
      if (meterRestcents !== 0) {
        targetLine.meterReadingShare = this.round2(targetLine.meterReadingShare + fromCents(meterRestcents));
        totalMeterReadingDistributed = this.round2(totalMeterReadingDistributed + fromCents(meterRestcents));
      }

      const totalRestcents = heatingRestcents + hotWaterRestcents + maintRestcents + meterRestcents;
      if (totalRestcents !== 0) {
        // totalCost und balance nach allen Korrekturen neu berechnen
        targetLine.totalCost = this.round2(
          targetLine.heatingTotal + targetLine.hotWaterTotal +
          targetLine.maintenanceShare + targetLine.meterReadingShare
        );
        targetLine.balance = this.round2(targetLine.totalCost - targetLine.prepayment);
        totalDistributed = this.round2(totalDistributed + fromCents(totalRestcents));

        warnings.push(`Restcent-Korrektur: ${fromCents(totalRestcents).toFixed(2)} EUR (komponentenweise) wurde Einheit ${targetLine.unitId} zugewiesen (${input.config.restCentRule === 'assign_to_largest_share' ? 'größter Anteil' : 'kleinster Anteil'})`);
      }
    }

    // Exakte Saldenprüfung in Integer-Cents: nach Restcent-Zuweisung MUSS die Differenz 0 sein.
    const trialBalanceDiffCents = totalCostsCents - toCents(totalDistributed);
    const trialBalanceDiff = fromCents(trialBalanceDiffCents);
    const trialBalanceOk = Math.abs(trialBalanceDiffCents) <= 1; // Toleranz: 1 Cent

    const complianceCheck = this.runComplianceCheck(input, lines);
    const plausibilityReport = this.buildPlausibilityReport(input, totalArea, totalHeatingConsumption, allPlausibilityFlags);

    return {
      lines,
      summary: {
        totalHeatingDistributed,
        totalHotWaterDistributed,
        totalMaintenanceDistributed,
        totalMeterReadingDistributed,
        totalDistributed,
        totalCosts,
        trialBalanceDiff,
        trialBalanceOk,
      },
      warnings,
      complianceCheck,
      plausibilityReport,
    };
  }

  private runComplianceCheck(input: HeatBillingInput, lines: HeatBillingLineResult[]): ComplianceCheckResult {
    const checks: ComplianceCheck[] = [];

    const hasHotWater = input.totalCosts.hotWaterSupply > 0;
    checks.push({
      paragraph: '§5 HeizKG',
      requirement: 'Getrennte Ausweisung von Heizung und Warmwasser',
      status: hasHotWater || input.totalCosts.heatingSupply > 0 ? 'ok' : 'warnung',
      details: hasHotWater
        ? 'Heizung und Warmwasser werden getrennt ausgewiesen'
        : 'Nur Heizkosten vorhanden – separate Warmwasserabrechnung nicht erforderlich',
    });

    const estimatedUnits = lines.filter(l => l.isEstimated);
    const allDocumented = estimatedUnits.every(l => l.estimationReason && l.estimationReason.length > 0);
    checks.push({
      paragraph: '§7 HeizKG',
      requirement: 'Messgeräte vorhanden oder Ersatzverteilung dokumentiert',
      status: estimatedUnits.length === 0 ? 'ok' : (allDocumented ? 'warnung' : 'fehler'),
      details: estimatedUnits.length === 0
        ? 'Alle Einheiten haben gültige Messdaten'
        : `${estimatedUnits.length} Einheit(en) ohne Messdaten – Ersatzverteilung ${allDocumented ? 'dokumentiert' : 'NICHT dokumentiert'}`,
    });

    const hcPct = input.config.heatingConsumptionSharePct;
    const haPct = input.config.heatingAreaSharePct;
    const hcValid = hcPct >= 55 && hcPct <= 65;
    const haValid = haPct >= 35 && haPct <= 45;
    const hSumValid = Math.abs(hcPct + haPct - 100) < 0.01;
    checks.push({
      paragraph: '§8 HeizKG',
      requirement: 'Verbrauchsanteil 55–65%, Flächenanteil 35–45%',
      status: hcValid && haValid && hSumValid ? 'ok' : 'fehler',
      details: `Heizung: Verbrauch ${hcPct}% / Fläche ${haPct}% (Summe ${(hcPct + haPct).toFixed(0)}%) – ${hcValid && haValid && hSumValid ? 'konform' : 'NICHT konform'}`,
    });

    const hwcPct = input.config.hotWaterConsumptionSharePct;
    const hwaPct = input.config.hotWaterAreaSharePct;
    if (hasHotWater) {
      const hwcValid = hwcPct >= 55 && hwcPct <= 65;
      const hwaValid = hwaPct >= 35 && hwaPct <= 45;
      const hwSumValid = Math.abs(hwcPct + hwaPct - 100) < 0.01;
      checks.push({
        paragraph: '§8 HeizKG (Warmwasser)',
        requirement: 'Warmwasser-Verbrauchsanteil 55–65%, Flächenanteil 35–45%',
        status: hwcValid && hwaValid && hwSumValid ? 'ok' : 'fehler',
        details: `Warmwasser: Verbrauch ${hwcPct}% / Fläche ${hwaPct}% (Summe ${(hwcPct + hwaPct).toFixed(0)}%) – ${hwcValid && hwaValid && hwSumValid ? 'konform' : 'NICHT konform'}`,
      });
    }

    // Strenge ISO-Datum-Validierung (YYYY-MM-DD).
    // `new Date()` allein reicht nicht: JS normalisiert z.B. "2025-02-30" zu
    // einem gültigen März-Datum und akzeptiert Nicht-ISO-Formate wie "Jan 1 2025".
    // Prüfung: (1) Regex-Format, (2) kein Invalid-Date, (3) Round-Trip-Konsistenz
    // (parsed ISO-String muss dasselbe Datum ergeben → fängt overflow-Normalisierung).
    const ISO_DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

    const parseStrictIso = (s: string): Date | null => {
      if (!ISO_DATE_RE.test(s)) return null;
      const d = new Date(`${s}T00:00:00Z`);
      if (isNaN(d.getTime())) return null;
      // Round-trip: serialisiertes Datum muss gleich sein (fängt "2025-02-30" → "2025-03-02")
      if (d.toISOString().slice(0, 10) !== s) return null;
      return d;
    };

    const periodFrom = parseStrictIso(input.periodFrom);
    const periodTo   = parseStrictIso(input.periodTo);

    const periodFromValid = periodFrom !== null;
    const periodToValid   = periodTo   !== null;

    let periodStatus: 'ok' | 'fehler';
    let periodDetails: string;

    if (!periodFromValid || !periodToValid) {
      periodStatus  = 'fehler';
      periodDetails = `Ungültiges Datum: periodFrom="${input.periodFrom}", periodTo="${input.periodTo}" – beide Felder müssen gültige ISO-Daten (YYYY-MM-DD) sein`;
    } else {
      const diffMonths =
        (periodTo.getFullYear() - periodFrom.getFullYear()) * 12 +
        (periodTo.getMonth() - periodFrom.getMonth());
      const periodInvalid = periodFrom >= periodTo;

      if (periodInvalid) {
        periodStatus  = 'fehler';
        periodDetails = `Ungültiger Zeitraum: periodFrom (${input.periodFrom}) ≥ periodTo (${input.periodTo})`;
      } else if (diffMonths < 1 || diffMonths > 12) {
        periodStatus  = 'fehler';
        periodDetails = `Abrechnungszeitraum: ${diffMonths} Monate (${input.periodFrom} bis ${input.periodTo}) – NICHT konform (muss 1–12 Monate sein)`;
      } else {
        periodStatus  = 'ok';
        periodDetails = `Abrechnungszeitraum: ${diffMonths} Monate (${input.periodFrom} bis ${input.periodTo}) – konform`;
      }
    }

    checks.push({
      paragraph: '§9 HeizKG',
      requirement: 'Abrechnungszeitraum 1–12 Monate, periodFrom < periodTo',
      status: periodStatus,
      details: periodDetails,
    });

    checks.push({
      paragraph: '§10 HeizKG',
      requirement: 'Verteilungsschlüssel dokumentiert',
      status: 'ok',
      details: `Heizung: ${hcPct}% Verbrauch / ${haPct}% Fläche | Warmwasser: ${hwcPct}% Verbrauch / ${hwaPct}% Fläche | Instandhaltung: nach Fläche | Ablesungskosten: pro Einheit`,
    });

    const hasEstimatedWithReason = estimatedUnits.every(l => l.estimationReason);
    checks.push({
      paragraph: '§12 HeizKG',
      requirement: 'Ersatzverteilung bei fehlenden Messdaten',
      status: estimatedUnits.length === 0 ? 'ok' : (hasEstimatedWithReason ? 'ok' : 'fehler'),
      details: estimatedUnits.length === 0
        ? 'Keine Ersatzverteilung erforderlich'
        : `${estimatedUnits.length} Einheit(en) mit Ersatzverteilung nach Fläche`,
    });

    const deadlineDate = new Date(periodTo);
    deadlineDate.setMonth(deadlineDate.getMonth() + 15);
    const now = new Date();
    checks.push({
      paragraph: '§14 HeizKG',
      requirement: 'Frist für Abrechnung (15 Monate nach Periodenende)',
      status: now <= deadlineDate ? 'ok' : 'fehler',
      details: `Frist: ${deadlineDate.toISOString().split('T')[0]} – ${now <= deadlineDate ? 'eingehalten' : 'ÜBERSCHRITTEN'}`,
    });

    const passed = checks.every(c => c.status !== 'fehler');

    return { passed, checks };
  }

  private buildPlausibilityReport(
    input: HeatBillingInput,
    totalArea: number,
    totalHeatingConsumption: number,
    flags: PlausibilityFlag[],
  ): PlausibilityReport {
    if (totalArea <= 0) {
      flags.push({ unitId: '', type: 'gesamtflaeche', message: 'Gesamtfläche ist 0 oder negativ' });
    }

    const unitsWithMeters = input.units.filter(u => u.heatingMeter && u.heatingMeter.value > 0);
    if (unitsWithMeters.length > 0 && totalHeatingConsumption <= 0) {
      flags.push({ unitId: '', type: 'gesamtverbrauch', message: 'Gesamtverbrauch Heizung ist 0 trotz vorhandener Messgeräte' });
    }

    const hcPct = input.config.heatingConsumptionSharePct;
    const haPct = input.config.heatingAreaSharePct;
    if (Math.abs(hcPct + haPct - 100) >= 0.01) {
      flags.push({ unitId: '', type: 'aufteilung_heizung', message: `Heizung: Verbrauchsanteil (${hcPct}%) + Flächenanteil (${haPct}%) ergibt nicht 100%` });
    }

    const hwcPct = input.config.hotWaterConsumptionSharePct;
    const hwaPct = input.config.hotWaterAreaSharePct;
    if (Math.abs(hwcPct + hwaPct - 100) >= 0.01) {
      flags.push({ unitId: '', type: 'aufteilung_warmwasser', message: `Warmwasser: Verbrauchsanteil (${hwcPct}%) + Flächenanteil (${hwaPct}%) ergibt nicht 100%` });
    }

    if (hcPct < 55 || hcPct > 65) {
      flags.push({ unitId: '', type: 'heizkg_bereich', message: `Heizung Verbrauchsanteil ${hcPct}% liegt außerhalb des HeizKG-Bereichs (55–65%)` });
    }
    if (haPct < 35 || haPct > 45) {
      flags.push({ unitId: '', type: 'heizkg_bereich', message: `Heizung Flächenanteil ${haPct}% liegt außerhalb des HeizKG-Bereichs (35–45%)` });
    }
    if (hwcPct < 55 || hwcPct > 65) {
      flags.push({ unitId: '', type: 'heizkg_bereich', message: `Warmwasser Verbrauchsanteil ${hwcPct}% liegt außerhalb des HeizKG-Bereichs (55–65%)` });
    }
    if (hwaPct < 35 || hwaPct > 45) {
      flags.push({ unitId: '', type: 'heizkg_bereich', message: `Warmwasser Flächenanteil ${hwaPct}% liegt außerhalb des HeizKG-Bereichs (35–45%)` });
    }

    return {
      passed: flags.length === 0,
      flags,
    };
  }
}

export const heatBillingService = new HeatBillingService();
