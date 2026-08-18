/**
 * Tests for createRaceSafeLoader — the generation-based race protection.
 *
 * Key invariants under test:
 *  1. A result is applied only when it is the LATEST outstanding read for
 *     that loader instance (no stale pre-flush reads overwriting post-flush 0).
 *  2. invalidate() discards all in-flight reads, including same-account reads
 *     started in a prior session (logout → same-user re-login).
 *  3. Only the most recent load() can ever apply — older loads are silently dropped.
 *
 * All tests use deferred promises (manually resolved) to control ordering.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRaceSafeLoader } from '../utils/raceSafeCountLoader';

// ── Helpers ───────────────────────────────────────────────────────────────────

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!:  (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function makeLoader(currentUserId: () => string | undefined) {
  const applied: number[] = [];
  const loader = createRaceSafeLoader(
    uid => Promise.resolve(0), // overridden per-test via custom countForUser
    currentUserId,
    n => applied.push(n),
  );
  return { loader, applied };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('createRaceSafeLoader', () => {

  it('applies the result when no concurrent read or session change occurred', async () => {
    let current: string | undefined = 'user-A';
    const applied: number[] = [];
    const d = deferred<number>();

    const loader = createRaceSafeLoader(
      () => d.promise,
      () => current,
      n => applied.push(n),
    );

    loader.load('user-A');
    d.resolve(3);
    await d.promise;

    assert.deepEqual(applied, [3]);
  });

  it('later load() wins: earlier same-user read is discarded when it resolves later', async () => {
    // Scenario: startup read (count=1) resolves AFTER post-flush read (count=0).
    // The banner must disappear — the flush result must win.
    let current: string | undefined = 'user-A';
    const applied: number[] = [];

    const dStartup = deferred<number>();
    const dFlush   = deferred<number>();

    let callIndex = 0;
    const loader = createRaceSafeLoader(
      () => (callIndex++ === 0 ? dStartup.promise : dFlush.promise),
      () => current,
      n => applied.push(n),
    );

    loader.load('user-A'); // startup read — generation=1
    loader.load('user-A'); // flush read   — generation=2 (startup read now stale)

    // Flush resolves first with 0
    dFlush.resolve(0);
    await dFlush.promise;

    // Startup read resolves later with stale count of 1
    dStartup.resolve(1);
    await dStartup.promise;

    // Only flush's 0 must have been applied — startup (1) is stale
    assert.deepEqual(applied, [0], 'post-flush 0 must win; stale startup count 1 must be discarded');
  });

  it('invalidate() discards in-flight read for same user (logout scenario)', async () => {
    let current: string | undefined = 'user-A';
    const applied: number[] = [];
    const d = deferred<number>();

    const loader = createRaceSafeLoader(
      () => d.promise,
      () => current,
      n => applied.push(n),
    );

    loader.load('user-A');
    loader.invalidate(); // logout — discard all in-flight reads
    current = undefined; // session ended

    d.resolve(5);
    await d.promise;

    assert.deepEqual(applied, [], 'read started before logout must be discarded after invalidate()');
  });

  it('invalidate() + same user re-login: pre-logout read does not apply to new session', async () => {
    // Regression: user-A logs out and immediately logs back in.
    // The pre-logout read must NOT apply to the new session.
    let current: string | undefined = 'user-A';
    const applied: number[] = [];

    const dOld = deferred<number>(); // pre-logout read
    const dNew = deferred<number>(); // post-login read

    let callCount = 0;
    const loader = createRaceSafeLoader(
      () => (callCount++ === 0 ? dOld.promise : dNew.promise),
      () => current,
      n => applied.push(n),
    );

    loader.load('user-A'); // pre-logout — generation=1
    loader.invalidate();   // logout bumps generation
    current = undefined;

    // Same user re-logs in
    current = 'user-A';
    loader.load('user-A'); // post-login — generation=3

    // Pre-logout read resolves first with stale count
    dOld.resolve(99);
    await dOld.promise;

    // Post-login read resolves with current count
    dNew.resolve(2);
    await dNew.promise;

    // Only the post-login result must be applied
    assert.deepEqual(applied, [2], 'pre-logout result (99) must be discarded; post-login (2) applied');
  });

  it('invalidate() + different user: pre-logout read does not apply to new session', async () => {
    let current: string | undefined = 'user-A';
    const applied: number[] = [];
    const d = deferred<number>();

    const loader = createRaceSafeLoader(
      () => d.promise,
      () => current,
      n => applied.push(n),
    );

    loader.load('user-A');
    loader.invalidate();  // logout
    current = 'user-B';  // different user logs in

    d.resolve(7);
    await d.promise;

    assert.deepEqual(applied, [], 'user-A stale read must not apply after user-B logs in');
  });

  it('storage error — onCount is never called', async () => {
    const applied: number[] = [];
    const d = deferred<number>();
    const loader = createRaceSafeLoader(
      () => d.promise,
      () => 'user-A',
      n => applied.push(n),
    );

    loader.load('user-A');
    d.reject(new Error('AsyncStorage read failed'));
    await d.promise.catch(() => {});

    assert.deepEqual(applied, []);
  });

  it('three concurrent loads: only the last one is applied', async () => {
    let current: string | undefined = 'user-A';
    const applied: number[] = [];

    const d1 = deferred<number>();
    const d2 = deferred<number>();
    const d3 = deferred<number>(); // latest

    let call = 0;
    const loader = createRaceSafeLoader(
      () => [d1.promise, d2.promise, d3.promise][call++] ?? d3.promise,
      () => current,
      n => applied.push(n),
    );

    loader.load('user-A'); // gen=1
    loader.load('user-A'); // gen=2
    loader.load('user-A'); // gen=3

    // Resolve all — latest (d3) resolves last
    d1.resolve(10);
    await d1.promise;
    d2.resolve(20);
    await d2.promise;
    d3.resolve(30);
    await d3.promise;

    assert.deepEqual(applied, [30], 'only the last load (30) must be applied');
  });

});
