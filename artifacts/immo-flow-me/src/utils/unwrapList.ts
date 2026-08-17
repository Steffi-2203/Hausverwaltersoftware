/**
 * Einige Listen-Endpunkte (z. B. GET /api/invoices) liefern ein Pagination-
 * Envelope { data, pagination }, andere ein nacktes Array. Diese Hilfe
 * akzeptiert beide Formen und liefert immer ein Array.
 */
export function unwrapList<T = any>(json: any): T[] {
  if (Array.isArray(json)) return json;
  if (json && Array.isArray(json.data)) return json.data;
  return [];
}
