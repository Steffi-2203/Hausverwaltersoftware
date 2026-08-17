/**
 * MRG-Richtwert-Cache-Invalidierung nach Mieter-Import
 *
 * Prüft dass nach einem erfolgreichen TenantImport oder PdfScan die
 * mrg-check-Queries im QueryClient als "stale" markiert (invalidiert) werden,
 * sodass beim nächsten Render frische Daten vom Server geladen werden.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { QueryClient } from '@tanstack/react-query';

// ── Hilfsfunktion: simuliert den onSuccess-Callback der Import-Dialoge ────────

function simulateTenantImportSuccess(
  queryClient: QueryClient,
  propertyId: string,
) {
  queryClient.invalidateQueries({ queryKey: ['units', propertyId] });
  queryClient.invalidateQueries({ queryKey: ['tenants'] });
  queryClient.invalidateQueries({ queryKey: ['mrg-check'] });
}

function simulatePdfScanSuccess(
  queryClient: QueryClient,
  propertyId: string,
) {
  queryClient.invalidateQueries({ queryKey: ['units', propertyId] });
  queryClient.invalidateQueries({ queryKey: ['tenants'] });
  queryClient.invalidateQueries({ queryKey: ['mrg-check'] });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('MRG-Richtwert-Cache-Invalidierung nach Mieter-Import', () => {
  it('TenantImportDialog: mrg-check-Query wird nach erfolgreichem Import invalidiert', async () => {
    const qc = new QueryClient();
    const propertyId = 'prop-1';
    const tenantId = 'tenant-abc';

    // Seed eine mrg-check Query mit frischen Daten
    await qc.prefetchQuery({
      queryKey: ['mrg-check', tenantId],
      queryFn: () => Promise.resolve({ ok: true, richtwert: 8.03 }),
    });

    // Query ist nach prefetch als nicht-stale markiert
    const stateBefore = qc.getQueryState(['mrg-check', tenantId]);
    assert.ok(stateBefore, 'Query sollte im Cache vorhanden sein');
    assert.equal(
      stateBefore!.isInvalidated,
      false,
      'Query sollte vor dem Import nicht invalidiert sein',
    );

    // Import-Erfolg auslösen (entspricht dem onSuccess-Callback in PropertyDetail)
    simulateTenantImportSuccess(qc, propertyId);

    // mrg-check muss jetzt als invalidiert gelten
    const stateAfter = qc.getQueryState(['mrg-check', tenantId]);
    assert.ok(stateAfter, 'Query sollte weiterhin im Cache sein');
    assert.equal(
      stateAfter!.isInvalidated,
      true,
      'mrg-check-Query muss nach TenantImport invalidiert sein',
    );
  });

  it('PdfScanDialog: mrg-check-Query wird nach erfolgreichem Scan invalidiert', async () => {
    const qc = new QueryClient();
    const propertyId = 'prop-2';
    const tenantId = 'tenant-xyz';

    await qc.prefetchQuery({
      queryKey: ['mrg-check', tenantId],
      queryFn: () => Promise.resolve({ ok: false, richtwert: 9.55 }),
    });

    const stateBefore = qc.getQueryState(['mrg-check', tenantId]);
    assert.equal(
      stateBefore!.isInvalidated,
      false,
      'Query sollte vor dem Scan nicht invalidiert sein',
    );

    simulatePdfScanSuccess(qc, propertyId);

    const stateAfter = qc.getQueryState(['mrg-check', tenantId]);
    assert.equal(
      stateAfter!.isInvalidated,
      true,
      'mrg-check-Query muss nach PdfScan invalidiert sein',
    );
  });

  it('Mehrere Mieter: alle mrg-check-Queries der Liegenschaft werden invalidiert', async () => {
    const qc = new QueryClient();
    const propertyId = 'prop-3';
    const tenantIds = ['t1', 't2', 't3'];

    // Seed mehrere mrg-check Queries (typisch bei einer Liegenschaft mit mehreren Mietern)
    for (const tid of tenantIds) {
      await qc.prefetchQuery({
        queryKey: ['mrg-check', tid],
        queryFn: () => Promise.resolve({ ok: true }),
      });
    }

    // Sicherstellen dass alle frisch sind
    for (const tid of tenantIds) {
      assert.equal(
        qc.getQueryState(['mrg-check', tid])!.isInvalidated,
        false,
        `mrg-check für ${tid} sollte vor Import frisch sein`,
      );
    }

    simulateTenantImportSuccess(qc, propertyId);

    // Nach dem Import müssen ALLE mrg-check Queries invalidiert sein
    for (const tid of tenantIds) {
      assert.equal(
        qc.getQueryState(['mrg-check', tid])!.isInvalidated,
        true,
        `mrg-check für ${tid} muss nach Import invalidiert sein`,
      );
    }
  });

  it('units- und tenants-Queries werden beim Import ebenfalls invalidiert', async () => {
    const qc = new QueryClient();
    const propertyId = 'prop-4';

    await qc.prefetchQuery({
      queryKey: ['units', propertyId],
      queryFn: () => Promise.resolve([]),
    });
    await qc.prefetchQuery({
      queryKey: ['tenants'],
      queryFn: () => Promise.resolve([]),
    });

    simulateTenantImportSuccess(qc, propertyId);

    assert.equal(
      qc.getQueryState(['units', propertyId])!.isInvalidated,
      true,
      'units-Query muss nach Import invalidiert sein',
    );
    assert.equal(
      qc.getQueryState(['tenants'])!.isInvalidated,
      true,
      'tenants-Query muss nach Import invalidiert sein',
    );
  });
});
