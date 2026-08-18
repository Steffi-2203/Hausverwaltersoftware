/**
 * Pure save-and-queue function — no React Native imports, fully injectable.
 *
 * Extracted from review.tsx/handleSave so the durable-outbox logic can be
 * unit-tested without React, AsyncStorage, or Haptics.
 *
 * Responsibilities:
 *  1. Persist the correction in the queue BEFORE any network attempt so it
 *     survives a mid-request process kill.
 *  2. Attempt the upload via the injected `upload` function.
 *  3. On success  → remove from queue, return { outcome: 'uploaded' }.
 *  4. On any failure (network error, non-ok status) → leave in queue,
 *     return { outcome: 'queued', retryable } so the caller can show the
 *     right UI message. `retryable` is true for 503 (server temporarily
 *     unavailable) and false for everything else.
 *  5. No payload (no form changes) → return { outcome: 'no_changes' }
 *     without touching the queue.
 */

import { type QueueHandle } from './flushCorrections';
import { type PendingCorrectionPayload } from './correctionQueueFactory';

/** A minimal upload interface — lets tests supply a fake. */
export type UploadFn = (
  payload: PendingCorrectionPayload,
  signal:  AbortSignal,
) => Promise<Response>;

export type SaveOutcome =
  | { outcome: 'uploaded' }
  | { outcome: 'queued'; retryable: boolean }
  | { outcome: 'no_changes' };

export interface SaveDeps {
  queue:      QueueHandle;
  upload:     UploadFn;
  userId:     string;
  timeoutMs?: number;
}

export async function saveCorrection(
  payload: PendingCorrectionPayload | null,
  deps:    SaveDeps,
): Promise<SaveOutcome> {
  if (!payload) return { outcome: 'no_changes' };

  const { queue, upload, userId, timeoutMs = 15_000 } = deps;

  // ── Durable enqueue — must happen before the network attempt ─────────────
  const queueId = await queue.enqueue(userId, payload);

  // ── Upload attempt ────────────────────────────────────────────────────────
  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    try {
      res = await upload(payload, controller.signal);
    } finally {
      clearTimeout(timer);
    }

    if (res.ok) {
      await queue.remove(queueId);
      return { outcome: 'uploaded' };
    }

    // Non-ok: item stays in queue; caller shows appropriate message.
    return { outcome: 'queued', retryable: res.status === 503 };

  } catch {
    // Network error, AbortError, or timeout — item stays in queue.
    return { outcome: 'queued', retryable: false };
  }
}
