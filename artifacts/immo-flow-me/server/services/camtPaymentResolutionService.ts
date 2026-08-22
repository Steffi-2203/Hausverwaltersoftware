export type CamtInvoiceCandidate = {
  id: string;
  tenantId: string;
  unitId: string;
  total: number;
  paid: number;
};

export type CamtResolution =
  | { status: "matched"; candidate: CamtInvoiceCandidate; reason: string }
  | { status: "ambiguous"; candidates: CamtInvoiceCandidate[]; reason: string }
  | { status: "unmatched"; candidates: []; reason: string };

/**
 * Resolves only proof-level matches. A reference may identify a partial
 * payment; amount-only matching is safe exclusively when exactly one open
 * balance has that amount. There is intentionally no "best match" fallback.
 */
export function resolveCamtPayment(
  candidates: CamtInvoiceCandidate[],
  amount: number,
  reference: string,
): CamtResolution {
  const normalizedReference = reference.toLowerCase();
  const referenced = candidates.filter((candidate) =>
    normalizedReference.includes(candidate.id.slice(0, 8).toLowerCase()),
  );
  const exactAmount = candidates.filter((candidate) =>
    Math.abs((candidate.total - candidate.paid) - Math.abs(amount)) < 0.005,
  );
  const matches = referenced.length > 0 ? referenced : exactAmount;
  if (matches.length === 1) {
    return {
      status: "matched",
      candidate: matches[0],
      reason: referenced.length ? "Eindeutige Rechnungsreferenz" : "Eindeutiger offener Betrag",
    };
  }
  if (matches.length > 1) {
    return {
      status: "ambiguous",
      candidates: matches,
      reason: `${matches.length} gleichwertige offene Forderungen – manuelle Klärung erforderlich`,
    };
  }
  return {
    status: "unmatched",
    candidates: [],
    reason: "Keine offene Forderung eindeutig passend",
  };
}