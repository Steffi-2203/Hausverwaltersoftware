/**
 * A receivable can only be settled by an incoming bank line. Keeping this
 * check outside of route/UI code makes the CAMT import and manual match paths
 * apply the same financial direction rule.
 */
export function requireIncomingBankPayment(amount: unknown): number {
  const normalized = Number(amount);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    throw new Error("Nur positive Zahlungseingänge können einer Forderung zugeordnet werden");
  }
  return normalized;
}