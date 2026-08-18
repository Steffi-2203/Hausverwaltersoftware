/**
 * Race-safe queue-count loader with monotonic generation tracking.
 *
 * Problems solved:
 *
 *  1. Concurrent same-user reads (startup read vs. post-flush read):
 *     A startup read can resolve after a post-flush read and overwrite
 *     the post-flush 0 with a stale pre-flush count. The badge would
 *     stay visible even though the queue is empty.
 *
 *  2. Logout → re-login as the same account:
 *     A read started in session N can resolve in session N+1, even if
 *     the user ID is the same. The stale count must be discarded.
 *
 * Solution — monotonic generation token:
 *   Every call to `load()` increments the internal generation counter
 *   and captures its own value. A result is applied only when the loader's
 *   current generation still equals the captured value. Because every new
 *   load() call increments the counter, only the *most recent* outstanding
 *   read can ever apply. Calling `invalidate()` (on logout or login) also
 *   bumps the generation, ensuring pre-transition reads are always discarded.
 *
 * This module has no React / AsyncStorage imports — it is fully unit-testable
 * with plain deferred promises.
 */

export interface RaceSafeLoader {
  /**
   * Initiate a count read for the given user. Increments the internal generation
   * so any previously initiated read (even for the same user) becomes stale.
   */
  load(userId: string): void;
  /**
   * Discard all in-flight reads regardless of user.
   * Call on logout and at the start of login before setting the new user.
   */
  invalidate(): void;
}

export function createRaceSafeLoader(
  countForUser:     (uid: string) => Promise<number>,
  getCurrentUserId: () => string | undefined,
  onCount:          (n: number) => void,
): RaceSafeLoader {
  let generation = 0;

  return {
    load(userId: string): void {
      const myGen = ++generation; // capture this read's generation
      countForUser(userId).then(n => {
        // Two guards:
        //   1. generation === myGen: ensures this is the latest outstanding read.
        //      A newer load() or invalidate() will have bumped generation past myGen.
        //   2. getCurrentUserId() === userId: belt-and-suspenders for the session.
        if (generation === myGen && getCurrentUserId() === userId) {
          onCount(n);
        }
      }).catch(() => {/* ignore storage errors — badge keeps last known value */});
    },

    invalidate(): void {
      generation++; // any in-flight read will find generation !== myGen and be discarded
    },
  };
}
