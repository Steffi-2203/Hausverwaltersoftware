/**
 * Pure flush function — no React Native imports, fully injectable.
 *
 * Extracted from AuthContext so it can be unit-tested without React or
 * AsyncStorage. Pass a fake `fetchFn` in tests; production code passes
 * the global `fetch`.
 *
 * Stop conditions (identical to the AuthContext behaviour that callers rely on):
 *  - queue is empty              → returns 0 immediately
 *  - res.ok                      → remove item, continue
 *  - res.status === 401          → token expired, break
 *  - res.status === 503          → server temporarily unavailable, break
 *  - network error / timeout     → break
 */

import { createCorrectionQueue } from './correctionQueueFactory';

export type QueueHandle = ReturnType<typeof createCorrectionQueue>;

/** A minimal fetch-compatible interface; lets tests supply a fake. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface FlushDeps {
  token:     string;
  userId:    string;
  apiDomain: string;
  queue:     QueueHandle;
  fetchFn:   FetchLike;
  timeoutMs?: number;
}

export async function flushCorrections({
  token,
  userId,
  apiDomain,
  queue,
  fetchFn,
  timeoutMs = 15_000,
}: FlushDeps): Promise<number> {
  const items = await queue.getForUser(userId);
  if (items.length === 0) return 0;

  let flushed = 0;

  for (const item of items) {
    try {
      const url        = `https://${apiDomain}/api/ocr/corrections`;
      const controller = new AbortController();
      const timer      = setTimeout(() => controller.abort(), timeoutMs);
      let res: Response;
      try {
        res = await fetchFn(url, {
          method:  'POST',
          headers: {
            'Content-Type':  'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body:   JSON.stringify(item.payload),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      if (res.ok) {
        await queue.remove(item.id);
        flushed++;
      }

      // Token expired — stop immediately; no point burning through the queue.
      if (res.status === 401) break;

      // Server temporarily unavailable (e.g. DB outage) — stop and retry on
      // the next foreground event or cold start.
      if (res.status === 503) break;

    } catch {
      // Network error or AbortError — stop; retry later.
      break;
    }
  }

  return flushed;
}
