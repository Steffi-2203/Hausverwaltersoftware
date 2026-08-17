/**
 * Tests for loginRequest utility.
 *
 * Covered scenarios:
 *  1. Timeout fires (AbortError) → throws German "Server nicht erreichbar" message
 *  2. Successful login before timeout → clearTimeout is called, no hanging timer /
 *     the AbortController signal is NOT aborted after the promise resolves
 *  3. Non-OK HTTP response → throws server error message
 *  4. requires2FA flag → throws 2FA message
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loginRequest } from '../utils/loginRequest';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Fake fetch that never resolves but fires the abort listener. */
function makeHangingFetch(): typeof fetch {
  return (_url: any, options?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      if (options?.signal?.aborted) {
        const err = new Error('The operation was aborted.');
        err.name = 'AbortError';
        reject(err);
        return;
      }
      options?.signal?.addEventListener('abort', () => {
        const err = new Error('The operation was aborted.');
        err.name = 'AbortError';
        reject(err);
      });
    });
}

/** Fake fetch that resolves immediately with the given JSON body. */
function makeOkFetch(body: object): typeof fetch {
  return (_url: any, _opts?: RequestInit) =>
    Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
}

/** Fake fetch that resolves immediately with a non-OK status. */
function makeErrorFetch(status: number, body: object): typeof fetch {
  return (_url: any, _opts?: RequestInit) =>
    Promise.resolve(new Response(JSON.stringify(body), { status }));
}

/** Fake fetch that captures the AbortSignal and resolves immediately. */
function makeCapturingFetch(
  body: object,
  capture: { signal?: AbortSignal },
): typeof fetch {
  return (_url: any, opts?: RequestInit) => {
    capture.signal = opts?.signal as AbortSignal | undefined;
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  };
}

const SAMPLE_SUCCESS = {
  token:          'tok-abc',
  id:             'user-1',
  email:          'test@example.com',
  fullName:       'Max Mustermann',
  organizationId: 'org-1',
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('loginRequest', () => {

  it('throws German error message when timeout fires (AbortError)', async () => {
    await assert.rejects(
      () => loginRequest(
        'https://example.com/api/auth/login',
        'a@b.com',
        'pw',
        { timeoutMs: 1, fetchFn: makeHangingFetch() },
      ),
      (err: Error) => {
        assert.equal(err.name, 'Error');
        assert.match(err.message, /Server nicht erreichbar/);
        assert.match(err.message, /Verbindung prüfen/);
        return true;
      },
    );
  });

  it('does not abort the signal after successful login (clearTimeout was called)', async () => {
    // We use a short timeout (50 ms) so that if clearTimeout were NOT called,
    // the AbortController would fire within 50 ms and set signal.aborted=true.
    // After the promise resolves we wait 100 ms and assert the signal is still
    // not aborted — proof that the timer was cleared.
    const captured: { signal?: AbortSignal } = {};

    await loginRequest(
      'https://example.com/api/auth/login',
      'test@example.com',
      'pw',
      {
        timeoutMs: 50,
        fetchFn:   makeCapturingFetch(SAMPLE_SUCCESS, captured),
      },
    );

    // Wait longer than the timeout; if clearTimeout was skipped, the abort fires here.
    await new Promise<void>(r => setTimeout(r, 100));

    assert.ok(captured.signal !== undefined, 'fetch should have been called');
    assert.strictEqual(
      captured.signal!.aborted,
      false,
      'AbortController signal must not be aborted after a successful login (clearTimeout was not called)',
    );
  });

  it('returns parsed user data on successful login', async () => {
    const result = await loginRequest(
      'https://example.com/api/auth/login',
      'test@example.com',
      'pw',
      { fetchFn: makeOkFetch(SAMPLE_SUCCESS) },
    );

    assert.equal(result.token,          SAMPLE_SUCCESS.token);
    assert.equal(result.id,             SAMPLE_SUCCESS.id);
    assert.equal(result.email,          SAMPLE_SUCCESS.email);
    assert.equal(result.fullName,       SAMPLE_SUCCESS.fullName);
    assert.equal(result.organizationId, SAMPLE_SUCCESS.organizationId);
  });

  it('falls back to email as fullName when server omits it', async () => {
    const body = { token: 'tok', id: 'u1', email: 'fallback@example.com' };
    const result = await loginRequest(
      'https://example.com/api/auth/login',
      'fallback@example.com',
      'pw',
      { fetchFn: makeOkFetch(body) },
    );
    assert.equal(result.fullName, 'fallback@example.com');
  });

  it('throws server error message on non-OK response', async () => {
    await assert.rejects(
      () => loginRequest(
        'https://example.com/api/auth/login',
        'a@b.com',
        'wrong-pw',
        { fetchFn: makeErrorFetch(401, { error: 'Ungültige Anmeldedaten' }) },
      ),
      (err: Error) => {
        assert.match(err.message, /Ungültige Anmeldedaten/);
        return true;
      },
    );
  });

  it('falls back to "Anmeldung fehlgeschlagen" when server error has no message', async () => {
    await assert.rejects(
      () => loginRequest(
        'https://example.com/api/auth/login',
        'a@b.com',
        'pw',
        { fetchFn: makeErrorFetch(500, {}) },
      ),
      (err: Error) => {
        assert.match(err.message, /Anmeldung fehlgeschlagen/);
        return true;
      },
    );
  });

  it('throws 2FA message when server signals requires2FA', async () => {
    await assert.rejects(
      () => loginRequest(
        'https://example.com/api/auth/login',
        'a@b.com',
        'pw',
        { fetchFn: makeOkFetch({ requires2FA: true }) },
      ),
      (err: Error) => {
        assert.match(err.message, /Zwei-Faktor/);
        assert.match(err.message, /Browser/);
        return true;
      },
    );
  });

});
