/**
 * Production wiring for the correction queue.
 * Uses Expo AsyncStorage as the storage backend.
 *
 * For tests, import `createCorrectionQueue` from
 * `utils/correctionQueueFactory` and inject an in-memory adapter instead.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createCorrectionQueue } from './correctionQueueFactory';

export type {
  StorageAdapter,
  PendingCorrectionPayload,
  PendingCorrection,
} from './correctionQueueFactory';

export { createCorrectionQueue } from './correctionQueueFactory';

/** Default singleton backed by AsyncStorage — use this in app code. */
export const correctionQueue = createCorrectionQueue(AsyncStorage);
