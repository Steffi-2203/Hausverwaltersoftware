/**
 * Pro-Rata (Aliquote) Mietzinsberechnung.
 *
 * Berechnet den anteiligen Mietzins für Ein- und Auszugsmonate nach
 * der österreichischen Tage-Methode (Monatstagezahl als Divisor).
 *
 * Exportiert als reine Funktionen ohne DB-Abhängigkeit — vollständig testbar.
 */
import { roundMoney } from "@shared/utils";

/** Anzahl der Tage im angegebenen Monat (z. B. Schaltjahr-sicher). */
export function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/**
 * Berechnet den anteiligen Mietzins für einen Teilmonat.
 *
 * @param monthlyRent  Monatlicher Gesamtmietzins (€)
 * @param startDay     Erster Tag der Miete im Monat (inklusiv, 1-basiert)
 * @param endDay       Letzter Tag der Miete im Monat (inklusiv, 1-basiert)
 * @param daysInMonth  Gesamtanzahl der Tage im Monat
 * @returns            Anteiliger Mietzins, kaufmännisch auf 2 Dezimalstellen gerundet
 */
export function calculateProRata(
  monthlyRent: number,
  startDay: number,
  endDay: number,
  daysInMonth: number,
): number {
  if (monthlyRent <= 0) return 0;
  const days = endDay - startDay + 1;
  if (days <= 0) return 0;
  return roundMoney((monthlyRent * days) / daysInMonth);
}

/**
 * Anteiliger Mietzins für den Einzugsmonat:
 * ab Einzugsdatum bis zum Monatsende.
 */
export function calculateMoveInProRata(monthlyRent: number, moveInDate: Date): number {
  const year = moveInDate.getFullYear();
  const month = moveInDate.getMonth() + 1;
  const startDay = moveInDate.getDate();
  const dim = getDaysInMonth(year, month);
  return calculateProRata(monthlyRent, startDay, dim, dim);
}

/**
 * Anteiliger Mietzins für den Auszugsmonat:
 * vom Monatsersten bis zum Auszugsdatum.
 */
export function calculateMoveOutProRata(monthlyRent: number, moveOutDate: Date): number {
  const year = moveOutDate.getFullYear();
  const month = moveOutDate.getMonth() + 1;
  const endDay = moveOutDate.getDate();
  const dim = getDaysInMonth(year, month);
  return calculateProRata(monthlyRent, 1, endDay, dim);
}
