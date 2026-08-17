/**
 * MRG-Richtwert-Cache-Invalidierung nach manueller Mieteränderung
 *
 * Prüft dass nach einem erfolgreichen useUpdateTenant-Aufruf (PATCH /api/tenants/:id)
 * die mrg-check-Query für den betreffenden Mieter als "stale" markiert (invalidiert)
 * wird, sodass beim nächsten Render frische Daten vom Server geladen werden.
 *
 * Die Tests importieren invalidateAfterTenantUpdate DIREKT aus dem Produktions-Code
 * (src/lib/tenantMutationHelpers.ts) – derselben Funktion, die useUpdateTenant.onSuccess
 * aufruft. Änderungen an der Invalidierungslogik (falsche Query-Keys, fehlendes mrg-check
 * etc.) schlagen hier sofort an.
 *
 * MutationObserver aus @tanstack/react-query ermöglicht das Ausführen der vollständigen
 * Mutation-Pipeline (mutationFn → onSuccess) ohne React-Kontext oder Browser-APIs.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { QueryClient, MutationObserver } from '@tanstack/react-query';

// ── Produktions-Code importieren ──────────────────────────────────────────────
// Dieser Import holt die ECHTE Invalidierungsfunktion aus dem selben Modul,
// das useUpdateTenant.onSuccess intern aufruft. Kein lokales Duplikat.
import {
  invalidateAfterTenantUpdate,
  invalidateAfterTenantDelete,
} from '../../src/lib/tenantMutationHelpers.ts';

// ── Hilfsfunktionen ───────────────────────────────────────────────────────────

/** Seed einen Query-Cache-Eintrag als "frisch" (nicht invalidiert). */
async function seedFreshQuery(qc: QueryClient, queryKey: unknown[]) {
  await qc.prefetchQuery({
    queryKey,
    queryFn: () => Promise.resolve({ seeded: true }),
  });
  assert.equal(
    qc.getQueryState(queryKey)?.isInvalidated,
    false,
    `${JSON.stringify(queryKey)} sollte nach prefetch frisch sein`,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('MRG-Richtwert-Cache-Invalidierung nach manueller Mieteränderung', () => {
  it('mrg-check-Query wird nach Grundmiete-Update invalidiert (via echtem MutationObserver)', async () => {
    const qc = new QueryClient();
    const tenantId = 'tenant-update-1';

    // Seed mrg-check als frisch (wie nach initialem Laden in PropertyDetail)
    await seedFreshQuery(qc, ['mrg-check', tenantId]);

    // MutationObserver mit dem ECHTEN onSuccess aus dem Produktions-Code
    // mutationFn gibt die Server-Antwort zurück (id muss vorhanden sein, damit
    // invalidateAfterTenantUpdate den richtigen Cache-Key trifft)
    const observer = new MutationObserver(qc, {
      mutationFn: async (_vars: { id: string; grundmiete: string }) =>
        Promise.resolve({ id: tenantId, grundmiete: '550.00' }),
      onSuccess(data) {
        // Diese Zeile ruft die PRODUKTIONSFUNKTION auf – identisch mit useUpdateTenant
        invalidateAfterTenantUpdate(qc, data);
      },
    });

    // Mutation ausführen (entspricht mutateAsync in useUpdateTenant)
    await observer.mutate({ id: tenantId, grundmiete: '550.00' });

    const stateAfter = qc.getQueryState(['mrg-check', tenantId]);
    assert.ok(stateAfter, 'mrg-check-Query sollte weiterhin im Cache sein');
    assert.equal(
      stateAfter!.isInvalidated,
      true,
      'mrg-check-Query muss nach Grundmiete-Update invalidiert sein',
    );
  });

  it('Nur die mrg-check des geänderten Mieters wird invalidiert, nicht die anderer Mieter', async () => {
    const qc = new QueryClient();
    const updatedId = 'tenant-changed';
    const otherId = 'tenant-other';

    await seedFreshQuery(qc, ['mrg-check', updatedId]);
    await seedFreshQuery(qc, ['mrg-check', otherId]);

    const observer = new MutationObserver(qc, {
      mutationFn: async (_vars: { id: string }) =>
        Promise.resolve({ id: updatedId }),
      onSuccess(data) {
        invalidateAfterTenantUpdate(qc, data);
      },
    });

    await observer.mutate({ id: updatedId });

    // Geänderter Mieter: invalidiert
    assert.equal(
      qc.getQueryState(['mrg-check', updatedId])!.isInvalidated,
      true,
      'mrg-check des geänderten Mieters muss invalidiert sein',
    );

    // Unberührter Mieter: weiterhin frisch
    assert.equal(
      qc.getQueryState(['mrg-check', otherId])!.isInvalidated,
      false,
      'mrg-check eines nicht geänderten Mieters darf nicht invalidiert werden',
    );
  });

  it('tenants-Liste und einzelne tenant-Query werden beim Update ebenfalls invalidiert', async () => {
    const qc = new QueryClient();
    const tenantId = 'tenant-list-check';

    await seedFreshQuery(qc, ['tenants']);
    await seedFreshQuery(qc, ['tenant', tenantId]);
    await seedFreshQuery(qc, ['units']);
    await seedFreshQuery(qc, ['mrg-check', tenantId]);

    const observer = new MutationObserver(qc, {
      mutationFn: async (_v: { id: string }) => Promise.resolve({ id: tenantId }),
      onSuccess(data) {
        invalidateAfterTenantUpdate(qc, data);
      },
    });

    await observer.mutate({ id: tenantId });

    assert.equal(qc.getQueryState(['tenants'])!.isInvalidated, true, 'tenants-Liste muss invalidiert sein');
    assert.equal(qc.getQueryState(['tenant', tenantId])!.isInvalidated, true, 'tenant-Einzelquery muss invalidiert sein');
    assert.equal(qc.getQueryState(['units'])!.isInvalidated, true, 'units-Query muss invalidiert sein');
    assert.equal(qc.getQueryState(['mrg-check', tenantId])!.isInvalidated, true, 'mrg-check muss invalidiert sein');
  });

  it('mrg-check bleibt nach Refetch korrekt invalidierbar (mehrere Updates)', async () => {
    const qc = new QueryClient();
    const tenantId = 'tenant-multi';

    await seedFreshQuery(qc, ['mrg-check', tenantId]);

    const makeObserver = () =>
      new MutationObserver(qc, {
        mutationFn: async (_v: { id: string }) => Promise.resolve({ id: tenantId }),
        onSuccess(data) {
          invalidateAfterTenantUpdate(qc, data);
        },
      });

    // 1. Update → invalidiert
    await makeObserver().mutate({ id: tenantId });
    assert.equal(qc.getQueryState(['mrg-check', tenantId])!.isInvalidated, true, 'Erstes Update muss invalidieren');

    // Simulierter Refetch: Query als frisch markieren
    await qc.prefetchQuery({
      queryKey: ['mrg-check', tenantId],
      queryFn: () => Promise.resolve({ ok: true, richtwert: 8.50 }),
    });
    assert.equal(qc.getQueryState(['mrg-check', tenantId])!.isInvalidated, false, 'Nach Refetch muss Query frisch sein');

    // 2. Update → wieder invalidiert
    await makeObserver().mutate({ id: tenantId });
    assert.equal(qc.getQueryState(['mrg-check', tenantId])!.isInvalidated, true, 'Zweites Update muss ebenfalls invalidieren');
  });

  it('mrg-check wird nach Mieter-Löschung invalidiert (useDeleteTenant-Pfad)', async () => {
    const qc = new QueryClient();
    const tenantId = 'tenant-deleted';

    await seedFreshQuery(qc, ['mrg-check', tenantId]);

    const observer = new MutationObserver(qc, {
      mutationFn: async (id: string) => { return undefined; },
      onSuccess(_data, id: string) {
        invalidateAfterTenantDelete(qc, id);
      },
    });

    await observer.mutate(tenantId);

    assert.equal(
      qc.getQueryState(['mrg-check', tenantId])!.isInvalidated,
      true,
      'mrg-check muss nach Mieter-Löschung invalidiert sein',
    );
  });
});
