/**
 * Zahlungsaufteilung nach österreichischem Hausverwaltungsstandard
 * Reihenfolge: 1. Betriebskosten → 2. Heizung → 3. Miete
 */

export interface InvoiceAmounts {
  grundmiete: number;
  betriebskosten: number;
  heizungskosten: number;
  ust?: number;
  gesamtbetrag: number;
}

export interface PaymentAllocation {
  betriebskosten_anteil: number;
  heizung_anteil: number;
  miete_anteil: number;
  ust_anteil: number;
  ueberzahlung: number;
  unterzahlung: number;
  vollstaendig_bezahlt: boolean;
}

export interface AllocationDetails {
  allocation: PaymentAllocation;
  beschreibung: string;
  status: 'vollstaendig' | 'teilbezahlt' | 'ueberzahlt';
}

/**
 * Verteilt eine Zahlung auf die Rechnungsposten nach folgender Priorität:
 * 1. Betriebskosten (inkl. 10% USt falls anwendbar)
 * 2. Heizungskosten (inkl. 20% USt falls anwendbar)
 * 3. Grundmiete (inkl. USt falls anwendbar)
 * 
 * @param zahlungsbetrag - Der eingegangene Betrag
 * @param invoice - Die offene Rechnung mit Beträgen
 * @param mitUst - Ob USt in der Rechnung enthalten ist (Standard: true für Geschäft)
 */
export function allocatePayment(
  zahlungsbetrag: number,
  invoice: InvoiceAmounts,
  mitUst: boolean = true
): AllocationDetails {
  let remaining = zahlungsbetrag;
  
  // Brutto-Beträge berechnen (mit USt-Sätzen aus Österreich)
  const bkBrutto = mitUst 
    ? invoice.betriebskosten * 1.10  // 10% USt auf BK
    : invoice.betriebskosten;
  
  const heizungBrutto = mitUst 
    ? invoice.heizungskosten * 1.20  // 20% USt auf Heizung
    : invoice.heizungskosten;
  
  const mieteBrutto = invoice.grundmiete; // Miete oft USt-frei bei Wohnung
  
  const gesamtSoll = bkBrutto + heizungBrutto + mieteBrutto;
  
  // 1. Betriebskosten zuordnen
  const bkZuordnung = Math.min(remaining, bkBrutto);
  remaining -= bkZuordnung;
  
  // 2. Heizung zuordnen
  const heizungZuordnung = Math.min(remaining, heizungBrutto);
  remaining -= heizungZuordnung;
  
  // 3. Miete zuordnen
  const mieteZuordnung = Math.min(remaining, mieteBrutto);
  remaining -= mieteZuordnung;
  
  // USt-Anteil berechnen (aus den zugeordneten Brutto-Beträgen)
  const ustBk = mitUst && bkZuordnung > 0 
    ? bkZuordnung - (bkZuordnung / 1.10)
    : 0;
  const ustHeizung = mitUst && heizungZuordnung > 0 
    ? heizungZuordnung - (heizungZuordnung / 1.20)
    : 0;
  
  const allocation: PaymentAllocation = {
    betriebskosten_anteil: Math.round(bkZuordnung * 100) / 100,
    heizung_anteil: Math.round(heizungZuordnung * 100) / 100,
    miete_anteil: Math.round(mieteZuordnung * 100) / 100,
    ust_anteil: Math.round((ustBk + ustHeizung) * 100) / 100,
    ueberzahlung: remaining > 0 ? Math.round(remaining * 100) / 100 : 0,
    unterzahlung: zahlungsbetrag < gesamtSoll 
      ? Math.round((gesamtSoll - zahlungsbetrag) * 100) / 100 
      : 0,
    vollstaendig_bezahlt: Math.abs(zahlungsbetrag - gesamtSoll) < 0.01
  };
  
  // Status und Beschreibung
  let status: 'vollstaendig' | 'teilbezahlt' | 'ueberzahlt';
  let beschreibung: string;
  
  if (allocation.vollstaendig_bezahlt) {
    status = 'vollstaendig';
    beschreibung = 'Rechnung vollständig bezahlt';
  } else if (remaining > 0) {
    status = 'ueberzahlt';
    beschreibung = `Überzahlung: ${allocation.ueberzahlung.toFixed(2)} €`;
  } else {
    status = 'teilbezahlt';
    const details: string[] = [];
    
    if (bkZuordnung < bkBrutto) {
      details.push(`BK: ${bkZuordnung.toFixed(2)}/${bkBrutto.toFixed(2)} €`);
    }
    if (heizungZuordnung < heizungBrutto && bkZuordnung >= bkBrutto) {
      details.push(`Heizung: ${heizungZuordnung.toFixed(2)}/${heizungBrutto.toFixed(2)} €`);
    }
    if (mieteZuordnung < mieteBrutto && heizungZuordnung >= heizungBrutto) {
      details.push(`Miete: ${mieteZuordnung.toFixed(2)}/${mieteBrutto.toFixed(2)} €`);
    }
    
    beschreibung = `Teilzahlung - Offen: ${allocation.unterzahlung.toFixed(2)} € (${details.join(', ')})`;
  }
  
  return { allocation, beschreibung, status };
}

/**
 * Berechnet die Zuordnung für mehrere Zahlungen gegen eine Rechnung
 */
export function allocateMultiplePayments(
  zahlungen: { betrag: number; datum: string }[],
  invoice: InvoiceAmounts
): { 
  einzelzuordnungen: (AllocationDetails & { datum: string; betrag: number })[];
  gesamtstatus: 'offen' | 'teilbezahlt' | 'bezahlt' | 'ueberzahlt';
  gesamtbezahlt: number;
  restbetrag: number;
} {
  // Sortiere nach Datum
  const sortedPayments = [...zahlungen].sort((a, b) => 
    new Date(a.datum).getTime() - new Date(b.datum).getTime()
  );
  
  let remainingInvoice: InvoiceAmounts = { ...invoice };
  let gesamtbezahlt = 0;
  const einzelzuordnungen: (AllocationDetails & { datum: string; betrag: number })[] = [];
  
  for (const zahlung of sortedPayments) {
    const result = allocatePayment(zahlung.betrag, remainingInvoice);
    einzelzuordnungen.push({
      ...result,
      datum: zahlung.datum,
      betrag: zahlung.betrag
    });
    
    gesamtbezahlt += zahlung.betrag;
    
    // Reduziere die verbleibenden Beträge für nächste Zahlung
    remainingInvoice = {
      betriebskosten: Math.max(0, remainingInvoice.betriebskosten - result.allocation.betriebskosten_anteil / 1.10),
      heizungskosten: Math.max(0, remainingInvoice.heizungskosten - result.allocation.heizung_anteil / 1.20),
      grundmiete: Math.max(0, remainingInvoice.grundmiete - result.allocation.miete_anteil),
      gesamtbetrag: 0 // wird neu berechnet
    };
    remainingInvoice.gesamtbetrag = 
      remainingInvoice.betriebskosten + 
      remainingInvoice.heizungskosten + 
      remainingInvoice.grundmiete;
  }
  
  const restbetrag = invoice.gesamtbetrag - gesamtbezahlt;
  let gesamtstatus: 'offen' | 'teilbezahlt' | 'bezahlt' | 'ueberzahlt';
  
  if (gesamtbezahlt === 0) {
    gesamtstatus = 'offen';
  } else if (restbetrag > 0.01) {
    gesamtstatus = 'teilbezahlt';
  } else if (restbetrag < -0.01) {
    gesamtstatus = 'ueberzahlt';
  } else {
    gesamtstatus = 'bezahlt';
  }
  
  return {
    einzelzuordnungen,
    gesamtstatus,
    gesamtbezahlt,
    restbetrag: Math.round(restbetrag * 100) / 100
  };
}

/**
 * Formatiert die Zuordnung für Anzeige
 */
export function formatAllocationForDisplay(allocation: PaymentAllocation): string[] {
  const lines: string[] = [];
  
  if (allocation.betriebskosten_anteil > 0) {
    lines.push(`Betriebskosten: ${allocation.betriebskosten_anteil.toFixed(2)} €`);
  }
  if (allocation.heizung_anteil > 0) {
    lines.push(`Heizung: ${allocation.heizung_anteil.toFixed(2)} €`);
  }
  if (allocation.miete_anteil > 0) {
    lines.push(`Miete: ${allocation.miete_anteil.toFixed(2)} €`);
  }
  if (allocation.ust_anteil > 0) {
    lines.push(`davon USt: ${allocation.ust_anteil.toFixed(2)} €`);
  }
  if (allocation.ueberzahlung > 0) {
    lines.push(`Überzahlung: +${allocation.ueberzahlung.toFixed(2)} €`);
  }
  if (allocation.unterzahlung > 0) {
    lines.push(`Offen: -${allocation.unterzahlung.toFixed(2)} €`);
  }
  
  return lines;
}
