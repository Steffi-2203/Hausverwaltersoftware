/**
 * Wiederverwendbarer Helper für Concurrent-Org-Isolationstests.
 *
 * Führt N parallele HTTP-Anfragen gegen zwei Express-Test-Apps aus (je
 * eine pro Organisation) und prüft, dass keine Antwort IDs der jeweils
 * anderen Organisation enthält (Connection-Pool-Schutz via app.current_org).
 *
 * Verwendungsbeispiel:
 *
 *   await assertConcurrentOrgIsolation({
 *     appA, appB,
 *     endpoint:     '/api/payments',
 *     ownIdsA:      [payA1, payA2],
 *     foreignIdsB:  [payB1],
 *     ownIdsB:      [payB1],
 *     foreignIdsA:  [payA1, payA2],
 *     extractIds: (body) => body.data?.map((i: any) => i.id) ?? body.map((i: any) => i.id),
 *   });
 */

import assert from 'node:assert/strict';
import request from 'supertest';

export interface ConcurrentIsolationOptions {
  /** Express-App für Org A (Session bereits injiziert) */
  appA: ReturnType<typeof import('express')['default']>;
  /** Express-App für Org B (Session bereits injiziert) */
  appB: ReturnType<typeof import('express')['default']>;
  /** GET-Pfad des zu testenden Endpunkts */
  endpoint: string;
  /** IDs eigener Items von Org A, die in jeder Org-A-Antwort vorhanden sein müssen */
  ownIdsA: string[];
  /** IDs eigener Items von Org B, die in jeder Org-B-Antwort vorhanden sein müssen */
  ownIdsB: string[];
  /** IDs von Org B, die in KEINER Org-A-Antwort auftauchen dürfen */
  foreignIdsA: string[];
  /** IDs von Org A, die in KEINER Org-B-Antwort auftauchen dürfen */
  foreignIdsB: string[];
  /**
   * Extrahiert alle IDs aus dem Response-Body.
   * Standard: body.data?.map(i => i.id) ?? body.map(i => i.id)
   */
  extractIds?: (body: any) => string[];
  /** Parallele Anfragen pro Organisation (Standard: 6) */
  parallelPerOrg?: number;
  /** Wiederholungsrunden (Standard: 1) */
  rounds?: number;
  /** Optionale Query-Parameter */
  query?: string;
}

const defaultExtractIds = (body: any): string[] => {
  if (Array.isArray(body))          return body.map((i: any) => i.id);
  if (Array.isArray(body?.data))    return body.data.map((i: any) => i.id);
  return [];
};

export async function assertConcurrentOrgIsolation(opts: ConcurrentIsolationOptions): Promise<void> {
  const {
    appA, appB,
    endpoint,
    ownIdsA, ownIdsB,
    foreignIdsA, foreignIdsB,
    extractIds = defaultExtractIds,
    parallelPerOrg = 6,
    rounds = 1,
    query = '',
  } = opts;

  const url = query ? `${endpoint}?${query}` : endpoint;

  for (let round = 0; round < rounds; round++) {
    const [aResults, bResults] = await Promise.all([
      Promise.all(Array.from({ length: parallelPerOrg }, () =>
        request(appA).get(url).expect(200).then(r => r.body),
      )),
      Promise.all(Array.from({ length: parallelPerOrg }, () =>
        request(appB).get(url).expect(200).then(r => r.body),
      )),
    ]);

    for (const body of aResults) {
      const ids = extractIds(body);
      for (const own of ownIdsA) {
        assert.ok(
          ids.includes(own),
          `Runde ${round}: Org-A-Antwort (${endpoint}) fehlt eigenes Item ${own}`,
        );
      }
      for (const foreign of foreignIdsA) {
        assert.ok(
          !ids.includes(foreign),
          `Runde ${round}: Org-A-Antwort (${endpoint}) enthält Fremd-Item ${foreign}`,
        );
      }
    }

    for (const body of bResults) {
      const ids = extractIds(body);
      for (const own of ownIdsB) {
        assert.ok(
          ids.includes(own),
          `Runde ${round}: Org-B-Antwort (${endpoint}) fehlt eigenes Item ${own}`,
        );
      }
      for (const foreign of foreignIdsB) {
        assert.ok(
          !ids.includes(foreign),
          `Runde ${round}: Org-B-Antwort (${endpoint}) enthält Fremd-Item ${foreign}`,
        );
      }
    }
  }
}
