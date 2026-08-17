/**
 * Pure factory for the correction queue — no React Native imports.
 * Import this in tests (inject a memory storage adapter).
 * Production code uses `utils/pendingCorrections.ts` which wires AsyncStorage.
 */

// ── Storage adapter interface ─────────────────────────────────────────────────

export interface StorageAdapter {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PendingCorrectionPayload {
  originalData:  Record<string, unknown>;
  correctedData: Record<string, unknown>;
  source:        string;
  fileName:      string;
}

export interface PendingCorrection {
  /** Unique id — used to remove this item after a successful upload. */
  id:      string;
  /** The authenticated user who created this correction. */
  userId:  string;
  payload: PendingCorrectionPayload;
  savedAt: string; // ISO-8601
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createCorrectionQueue(
  storage:  StorageAdapter,
  queueKey: string = 'immo_ocr_pending_corrections',
) {
  async function loadQueue(): Promise<PendingCorrection[]> {
    try {
      const raw = await storage.getItem(queueKey);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  async function saveQueue(queue: PendingCorrection[]): Promise<void> {
    await storage.setItem(queueKey, JSON.stringify(queue));
  }

  /** Persist a correction. Returns the assigned id. */
  async function enqueue(userId: string, payload: PendingCorrectionPayload): Promise<string> {
    const queue = await loadQueue();
    const id    = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    queue.push({ id, userId, payload, savedAt: new Date().toISOString() });
    await saveQueue(queue);
    return id;
  }

  /** Return all pending corrections for a specific user (oldest first). */
  async function getForUser(userId: string): Promise<PendingCorrection[]> {
    const queue = await loadQueue();
    return queue.filter(item => item.userId === userId);
  }

  /** Remove a single item by id (call after a confirmed successful upload). */
  async function remove(id: string): Promise<void> {
    const queue = await loadQueue();
    await saveQueue(queue.filter(item => item.id !== id));
  }

  /** How many corrections are currently queued for a user. */
  async function countForUser(userId: string): Promise<number> {
    return (await getForUser(userId)).length;
  }

  return { enqueue, getForUser, remove, countForUser };
}
