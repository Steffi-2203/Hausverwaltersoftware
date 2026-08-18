/**
 * Tests for validateStoredToken — startup token validation against the server.
 *
 * Security invariant (Task #195):
 *   When an app restart loads a stored token that is expired or forged,
 *   the token must be rejected by the server (401) and cleared from storage
 *   immediately so the next startup does not re-enter a logged-in state.
 *
 * Scenarios:
 *  1. No stored credentials → returns { valid: false } without any fetch call
 *  2. Valid token → server returns 200 → { valid: true, token, user }
 *  3. Expired token → server returns 401 → storage cleared, { valid: false }
 *  4. Forged token → server returns 401 → storage cleared, { valid: false }
 *  5. Server returns 403 → storage cleared, { valid: false }
 *  6. Server returns 503 (server error) → token kept, { valid: true } (offline grace)
 *  7. Network error / timeout → token kept, { valid: true } (offline grace)
 *  8. After 401: loadAuthCredentials returns null (storage was actually cleared)
 *  9. After network error: loadAuthCredentials still returns credentials (not cleared)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateStoredToken, type FetchFn } from '../utils/validateStoredToken';
import {
  saveAuthCredentials,
  loadAuthCredentials,
  TOKEN_KEY,
  USER_KEY,
  type StorageAdapter,
  type StoredAuthUser,
} from '../utils/authStorage';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeStore(initial: Record<string, string> = {}): {
  adapter: StorageAdapter;
  raw: () => Record<string, string>;
} {
  const store: Record<string, string> = { ...initial };
  return {
    adapter: {
      getItemAsync:    async k     => store[k] ?? null,
      setItemAsync:    async (k,v) => { store[k] = v; },
      deleteItemAsync: async k     => { delete store[k]; },
    },
    raw: () => ({ ...store }),
  };
}

function makeFetch(status: number): FetchFn {
  return async () => ({ status, ok: status >= 200 && status < 300 } as Response);
}

function makeNetworkErrorFetch(): FetchFn {
  return async () => { throw new Error('Network request failed'); };
}

const SAMPLE_USER: StoredAuthUser = {
  id:             'user-uuid-1',
  email:          'test@example.com',
  fullName:       'Max Mustermann',
  organizationId: 'org-uuid-1',
};
const SAMPLE_TOKEN = 'tok-abcdef-12345678';
const VALIDATE_URL  = 'https://api.example.com/api/auth/validate';

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('validateStoredToken (Task #195 — startup token validation)', () => {

  it('[1] no stored credentials → returns { valid: false } without fetching', async () => {
    const { adapter } = makeStore(); // empty
    let fetchCalled = false;
    const result = await validateStoredToken(
      adapter,
      async () => { fetchCalled = true; return { status: 200, ok: true } as Response; },
      VALIDATE_URL,
    );
    assert.equal(result.valid, false);
    assert.equal(result.token, null);
    assert.equal(result.user,  null);
    assert.equal(fetchCalled, false, 'fetch must not be called when no credentials exist');
  });

  it('[2] valid token → server returns 200 → { valid: true, token, user }', async () => {
    const { adapter } = makeStore();
    await saveAuthCredentials(adapter, SAMPLE_TOKEN, SAMPLE_USER);

    const result = await validateStoredToken(adapter, makeFetch(200), VALIDATE_URL);

    assert.equal(result.valid, true);
    assert.equal(result.token, SAMPLE_TOKEN);
    assert.deepEqual(result.user, SAMPLE_USER);
  });

  it('[3] expired token → server returns 401 → storage cleared, { valid: false }', async () => {
    const { adapter, raw } = makeStore();
    await saveAuthCredentials(adapter, 'expired-token-xyz', SAMPLE_USER);

    const result = await validateStoredToken(adapter, makeFetch(401), VALIDATE_URL);

    assert.equal(result.valid, false, '401 must invalidate the session');
    assert.equal(result.token, null);
    assert.equal(result.user,  null);
    assert.equal(TOKEN_KEY in raw(), false, 'TOKEN_KEY must be deleted from storage after 401');
    assert.equal(USER_KEY  in raw(), false, 'USER_KEY must be deleted from storage after 401');
  });

  it('[4] forged token → server returns 401 → storage cleared, { valid: false }', async () => {
    const { adapter, raw } = makeStore();
    await saveAuthCredentials(adapter, 'forged-token-that-never-existed', SAMPLE_USER);

    const result = await validateStoredToken(adapter, makeFetch(401), VALIDATE_URL);

    assert.equal(result.valid, false, 'A forged token must not yield a valid session');
    assert.equal(TOKEN_KEY in raw(), false, 'TOKEN_KEY must be cleared for a forged token');
    assert.equal(USER_KEY  in raw(), false, 'USER_KEY must be cleared for a forged token');
  });

  it('[5] server returns 403 → storage cleared, { valid: false }', async () => {
    const { adapter, raw } = makeStore();
    await saveAuthCredentials(adapter, SAMPLE_TOKEN, SAMPLE_USER);

    const result = await validateStoredToken(adapter, makeFetch(403), VALIDATE_URL);

    assert.equal(result.valid, false);
    assert.equal(TOKEN_KEY in raw(), false, 'TOKEN_KEY must be cleared on 403');
  });

  it('[6] server returns 503 (server error) → token kept, { valid: true } (offline grace)', async () => {
    const { adapter, raw } = makeStore();
    await saveAuthCredentials(adapter, SAMPLE_TOKEN, SAMPLE_USER);

    const result = await validateStoredToken(adapter, makeFetch(503), VALIDATE_URL);

    assert.equal(result.valid, true, '503 (server error) must not clear the session — server might recover');
    assert.equal(result.token, SAMPLE_TOKEN);
    assert.ok(TOKEN_KEY in raw(), 'TOKEN_KEY must NOT be cleared on 503');
    assert.ok(USER_KEY  in raw(), 'USER_KEY must NOT be cleared on 503');
  });

  it('[6b] server returns 500 → token kept, { valid: true } (offline grace)', async () => {
    const { adapter, raw } = makeStore();
    await saveAuthCredentials(adapter, SAMPLE_TOKEN, SAMPLE_USER);

    const result = await validateStoredToken(adapter, makeFetch(500), VALIDATE_URL);

    assert.equal(result.valid, true, '500 must not clear the session');
    assert.ok(TOKEN_KEY in raw(), 'TOKEN_KEY must NOT be cleared on 500');
  });

  it('[6c] 429 (rate-limited) → credentials preserved in SecureStore but NOT authenticated', async () => {
    // The rate-limiter fired before the token could be verified.
    // SecureStore is preserved so the next startup can retry validation,
    // but the app must NOT enter authenticated state with an unverified token.
    const { adapter, raw } = makeStore();
    await saveAuthCredentials(adapter, SAMPLE_TOKEN, SAMPLE_USER);

    const result = await validateStoredToken(adapter, makeFetch(429), VALIDATE_URL);

    assert.equal(result.valid, false, '429 must NOT enter authenticated state — token unverified');
    assert.equal(result.token, null, 'token must not be exposed in result when not authenticated');
    assert.ok(TOKEN_KEY in raw(), 'TOKEN_KEY must remain in SecureStore so next startup can retry');
    assert.ok(USER_KEY  in raw(), 'USER_KEY must remain in SecureStore so next startup can retry');
  });

  it('[6d] 404 (unexpected client error) → credentials preserved but NOT authenticated', async () => {
    // A 404 means the validation endpoint was not found — possibly a config error.
    // Do not enter auth state with an unverified token, but don't clear credentials.
    const { adapter, raw } = makeStore();
    await saveAuthCredentials(adapter, SAMPLE_TOKEN, SAMPLE_USER);

    const result = await validateStoredToken(adapter, makeFetch(404), VALIDATE_URL);

    assert.equal(result.valid, false, '404 must NOT enter authenticated state');
    assert.equal(result.token, null);
    assert.ok(TOKEN_KEY in raw(), 'TOKEN_KEY must remain in SecureStore on 404');
    assert.ok(USER_KEY  in raw(), 'USER_KEY must remain in SecureStore on 404');
  });

  it('[7] network error → token kept, { valid: true } (offline grace)', async () => {
    const { adapter, raw } = makeStore();
    await saveAuthCredentials(adapter, SAMPLE_TOKEN, SAMPLE_USER);

    const result = await validateStoredToken(adapter, makeNetworkErrorFetch(), VALIDATE_URL);

    assert.equal(result.valid, true, 'Network error must not clear session — user might be offline');
    assert.equal(result.token, SAMPLE_TOKEN);
    assert.ok(TOKEN_KEY in raw(), 'TOKEN_KEY must remain when network is unavailable');
    assert.ok(USER_KEY  in raw(), 'USER_KEY must remain when network is unavailable');
  });

  it('[8] after 401: loadAuthCredentials returns null (storage was actually cleared)', async () => {
    const { adapter } = makeStore();
    await saveAuthCredentials(adapter, 'expired-token', SAMPLE_USER);

    await validateStoredToken(adapter, makeFetch(401), VALIDATE_URL);

    const afterValidation = await loadAuthCredentials(adapter);
    assert.equal(
      afterValidation,
      null,
      'After a 401 startup validation, loadAuthCredentials must return null — no silent re-auth on next startup',
    );
  });

  it('[9] after network error: loadAuthCredentials still returns credentials (not cleared)', async () => {
    const { adapter } = makeStore();
    await saveAuthCredentials(adapter, SAMPLE_TOKEN, SAMPLE_USER);

    await validateStoredToken(adapter, makeNetworkErrorFetch(), VALIDATE_URL);

    const afterValidation = await loadAuthCredentials(adapter);
    assert.ok(afterValidation !== null, 'Credentials must survive a network error (offline use)');
    assert.equal(afterValidation.token, SAMPLE_TOKEN);
  });

});
