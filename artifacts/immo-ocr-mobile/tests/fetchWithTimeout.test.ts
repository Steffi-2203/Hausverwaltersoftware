/**
 * Tests for fetchWithTimeout utility.
 *
 * Covered scenarios:
 *  1. Default timeout fires → German AbortError message is thrown
 *  2. Caller-supplied signal aborts the request independently of the timeout
 *  3. Normal response is returned unchanged
 */

import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { fetchWithTimeout } from '../utils/fetchWithTimeout';

// ── Helper: build a fake fetch that never resolves (simulates a hanging server) ──

function makeHangingFetch(): typeof fetch {
  return (_url: any, options?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      // Abort if a signal is already aborted before fetch starts
      if (options?.signal?.aborted) {
        const err = new Error('AbortError');
        err.name = 'AbortError';
        reject(err);
        return;
      }
      options?.signal?.addEventListener('abort', () => {
        const err = new Error('AbortError');
        err.name = 'AbortError';
        reject(err);
      });
    });
}

// ── Helper: build a fake fetch that resolves immediately with a 200 response ──

function makeOkFetch(body = '{}'): typeof fetch {
  return () => Promise.resolve(new Response(body, { status: 200 }));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('fetchWithTimeout', () => {

  it('throws German message when timeout fires', async () => {
    // Use a very short timeout (1 ms) so the test is instant.
    const realFetch = globalThis.fetch;
    // @ts-ignore — replace global fetch for this test
    globalThis.fetch = makeHangingFetch();
    try {
      await assert.rejects(
        () => fetchWithTimeout('https://example.com/', {}, 1),
        (err: Error) => {
          assert.equal(err.name, 'Error');
          assert.match(err.message, /Server nicht erreichbar/);
          return true;
        },
      );
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('caller-supplied signal aborts the request before timeout expires', async () => {
    const realFetch = globalThis.fetch;
    // @ts-ignore
    globalThis.fetch = makeHangingFetch();
    try {
      const callerController = new AbortController();

      // Long timeout (10 s) — the test must finish in ms via the caller signal.
      const fetchPromise = fetchWithTimeout(
        'https://example.com/',
        { signal: callerController.signal },
        10_000,
      );

      // Abort immediately via the caller's controller.
      callerController.abort();

      await assert.rejects(
        () => fetchPromise,
        (err: Error) => {
          assert.match(err.message, /Server nicht erreichbar/);
          return true;
        },
      );
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('returns the response unchanged on success', async () => {
    const realFetch = globalThis.fetch;
    // @ts-ignore
    globalThis.fetch = makeOkFetch('{"ok":true}');
    try {
      const res = await fetchWithTimeout('https://example.com/', {}, 5_000);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.deepEqual(body, { ok: true });
    } finally {
      globalThis.fetch = realFetch;
    }
  });

});
