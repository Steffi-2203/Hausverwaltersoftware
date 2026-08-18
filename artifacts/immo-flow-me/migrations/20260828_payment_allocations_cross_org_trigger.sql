-- Migration: Defense-in-Depth für payment_allocations (Task #167)
--
-- Hintergrund:
--   Die RLS-Policy auf payment_allocations scopet die Sichtbarkeit über payment_id.
--   Damit ist gewährleistet, dass nur eigene Zahlungen sichtbar sind — aber ein
--   INSERT mit einer fremden invoice_id würde noch keinen DB-Fehler auslösen.
--   Die bestehende Route (POST /api/payment-allocations) prüft den Cross-Org-
--   Schutz auf Applikationsebene (Task #121), aber ohne DB-seitige Absicherung
--   könnte ein direkter SQL-Zugriff (Admin-Tool, Migrationsskript, neue Route)
--   eine Zahlung der eigenen Org mit einer Rechnung einer fremden Org verknüpfen.
--
-- Lösung: BEFORE INSERT Trigger, der unabhängig von app.current_org prüft,
--   dass invoice_id und payment_id zur selben Organisation UND zum selben
--   Mieter gehören. Greift für ALLE Verbindungen (auch rootDb / BYPASSRLS),
--   da Trigger nicht von RLS-Policies abhängen.
--
-- Kompatibilität:
--   - trg_payment_allocations_immutable (UPDATE/DELETE-Schutz) bleibt unverändert.
--   - Bestandszeilen sind nicht betroffen (kein CONSTRAINT TRIGGER, kein VALIDATE).
--   - invoice_id darf NULL sein (Vorauszahlung ohne direkte Rechnungszuordnung).
--
-- Idempotent: CREATE OR REPLACE + DROP TRIGGER IF EXISTS.

-- ── 1. Trigger-Funktion ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION check_payment_allocation_cross_org()
RETURNS TRIGGER AS $$
DECLARE
  v_payment_org_id    uuid;
  v_invoice_org_id    uuid;
  v_payment_tenant_id uuid;
  v_invoice_tenant_id uuid;
BEGIN
  -- NULL invoice_id ist erlaubt (Vorauszahlung / manuell nicht zugeordnet)
  IF NEW.invoice_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Org und Mieter der Zahlung ermitteln (payment → tenant → unit → property)
  SELECT p.organization_id, py.tenant_id
    INTO v_payment_org_id, v_payment_tenant_id
    FROM payments py
    JOIN tenants  t ON t.id = py.tenant_id
    JOIN units    u ON u.id = t.unit_id
    JOIN properties p ON p.id = u.property_id
   WHERE py.id = NEW.payment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'payment_allocations: Zahlung % nicht gefunden oder Kette payment→tenant→unit→property unvollständig.',
      NEW.payment_id;
  END IF;

  -- Org und Mieter der Rechnung ermitteln (monthly_invoice → unit → property)
  SELECT p.organization_id, mi.tenant_id
    INTO v_invoice_org_id, v_invoice_tenant_id
    FROM monthly_invoices mi
    JOIN units      u ON u.id = mi.unit_id
    JOIN properties p ON p.id = u.property_id
   WHERE mi.id = NEW.invoice_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'payment_allocations: Rechnung % nicht gefunden oder Kette monthly_invoice→unit→property unvollständig.',
      NEW.invoice_id;
  END IF;

  -- ── Org-Grenzcheck ──────────────────────────────────────────────────────
  IF v_payment_org_id IS DISTINCT FROM v_invoice_org_id THEN
    RAISE EXCEPTION
      'payment_allocations: Rechnung (Org %) gehört nicht zur selben Organisation wie die Zahlung (Org %). '
      'Cross-Org-Zuordnung ist verboten (Defense-in-Depth, Task #167).',
      v_invoice_org_id, v_payment_org_id;
  END IF;

  -- ── Mieter-Identitätscheck (Defense-in-Depth) ───────────────────────────
  -- Nur prüfen wenn die Rechnung eine tenant_id hat (ältere Rows können NULL sein).
  IF v_invoice_tenant_id IS NOT NULL
     AND v_payment_tenant_id IS DISTINCT FROM v_invoice_tenant_id THEN
    RAISE EXCEPTION
      'payment_allocations: Rechnung (Mieter %) gehört nicht zum selben Mieter wie die Zahlung (Mieter %). '
      'Eine Zahlung darf nur mit Rechnungen des eigenen Mieters verknüpft werden.',
      v_invoice_tenant_id, v_payment_tenant_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── 2. Trigger ───────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_payment_allocations_cross_org ON payment_allocations;

CREATE TRIGGER trg_payment_allocations_cross_org
BEFORE INSERT ON payment_allocations
FOR EACH ROW
EXECUTE FUNCTION check_payment_allocation_cross_org();
