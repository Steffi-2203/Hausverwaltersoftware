export function normalizeDescription(raw?: string | null): string | null {
  if (raw === undefined || raw === null) return null;
  let s = String(raw).trim();
  if (s.normalize) s = s.normalize('NFC');
  s = s.replace(/\s+/g, ' ');
  s = s.toLowerCase();
  s = s.replace(/[\u200B-\u200D\uFEFF]/g, '');
  return s;
}
