/**
 * Tests for authStorage utilities — the pure storage layer for auth credentials.
 *
 * All tests use an in-memory StorageAdapter — no expo-secure-store, no React.
 *
 * Scenarios:
 *  1. saveAuthCredentials stores token under TOKEN_KEY and user JSON under USER_KEY
 *  2. loadAuthCredentials returns the stored token and parsed user
 *  3. loadAuthCredentials returns null when token is absent
 *  4. loadAuthCredentials returns null when user is absent
 *  5. clearAuthCredentials deletes BOTH TOKEN_KEY and USER_KEY (logout invariant)
 *  6. clearAuthCredentials on an already-empty store does not throw
 *  7. Full login → logout flow: credentials are unreadable after clearAuthCredentials
 *  8. loadAuthCredentials returns null for corrupted user JSON (defensive)
 *
 * Task #195: covers "logout() clears SecureStore completely (both TOKEN_KEY and USER_KEY)"
 * and "the case where the stored token is expired/invalid" (credentials removed on logout).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  TOKEN_KEY,
  USER_KEY,
  saveAuthCredentials,
  clearAuthCredentials,
  loadAuthCredentials,
  type StorageAdapter,
  type StoredAuthUser,
} from '../utils/authStorage';

// ── In-memory StorageAdapter ──────────────────────────────────────────────────

function makeStore(initial: Record<string, string> = {}): {
  adapter: StorageAdapter;
  /** Direct read for assertions — bypasses adapter interface. */
  raw: () => Record<string, string>;
} {
  const store: Record<string, string> = { ...initial };
  const adapter: StorageAdapter = {
    getItemAsync:    async (key)        => store[key] ?? null,
    setItemAsync:    async (key, value) => { store[key] = value; },
    deleteItemAsync: async (key)        => { delete store[key]; },
  };
  return { adapter, raw: () => ({ ...store }) };
}

// ── Sample data ───────────────────────────────────────────────────────────────

const SAMPLE_TOKEN = 'tok-abcdef-12345678';
const SAMPLE_USER: StoredAuthUser = {
  id:             'user-uuid-1',
  email:          'test@example.com',
  fullName:       'Max Mustermann',
  organizationId: 'org-uuid-1',
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('authStorage', () => {

  // ── 1. saveAuthCredentials ────────────────────────────────────────────────

  it('saveAuthCredentials writes token to TOKEN_KEY', async () => {
    const { adapter, raw } = makeStore();
    await saveAuthCredentials(adapter, SAMPLE_TOKEN, SAMPLE_USER);
    assert.equal(raw()[TOKEN_KEY], SAMPLE_TOKEN);
  });

  it('saveAuthCredentials writes serialised user to USER_KEY', async () => {
    const { adapter, raw } = makeStore();
    await saveAuthCredentials(adapter, SAMPLE_TOKEN, SAMPLE_USER);
    const stored = JSON.parse(raw()[USER_KEY]);
    assert.deepEqual(stored, SAMPLE_USER);
  });

  // ── 2. loadAuthCredentials ────────────────────────────────────────────────

  it('loadAuthCredentials returns saved token and parsed user', async () => {
    const { adapter } = makeStore();
    await saveAuthCredentials(adapter, SAMPLE_TOKEN, SAMPLE_USER);
    const result = await loadAuthCredentials(adapter);
    assert.ok(result !== null, 'loadAuthCredentials should return a value after save');
    assert.equal(result.token, SAMPLE_TOKEN);
    assert.deepEqual(result.user, SAMPLE_USER);
  });

  it('loadAuthCredentials returns null when TOKEN_KEY is absent', async () => {
    const { adapter } = makeStore({ [USER_KEY]: JSON.stringify(SAMPLE_USER) });
    const result = await loadAuthCredentials(adapter);
    assert.equal(result, null);
  });

  it('loadAuthCredentials returns null when USER_KEY is absent', async () => {
    const { adapter } = makeStore({ [TOKEN_KEY]: SAMPLE_TOKEN });
    const result = await loadAuthCredentials(adapter);
    assert.equal(result, null);
  });

  it('loadAuthCredentials returns null for corrupted user JSON', async () => {
    const { adapter } = makeStore({
      [TOKEN_KEY]: SAMPLE_TOKEN,
      [USER_KEY]:  'not-valid-json{{{{',
    });
    const result = await loadAuthCredentials(adapter);
    assert.equal(result, null, 'corrupted JSON must be treated as logged-out');
  });

  // ── 5. clearAuthCredentials ───────────────────────────────────────────────

  it('clearAuthCredentials removes TOKEN_KEY', async () => {
    const { adapter, raw } = makeStore({
      [TOKEN_KEY]: SAMPLE_TOKEN,
      [USER_KEY]:  JSON.stringify(SAMPLE_USER),
    });
    await clearAuthCredentials(adapter);
    assert.equal(raw()[TOKEN_KEY], undefined, 'TOKEN_KEY must be deleted after logout');
  });

  it('clearAuthCredentials removes USER_KEY', async () => {
    const { adapter, raw } = makeStore({
      [TOKEN_KEY]: SAMPLE_TOKEN,
      [USER_KEY]:  JSON.stringify(SAMPLE_USER),
    });
    await clearAuthCredentials(adapter);
    assert.equal(raw()[USER_KEY], undefined, 'USER_KEY must be deleted after logout');
  });

  it('clearAuthCredentials removes BOTH keys in a single call (logout invariant)', async () => {
    const { adapter, raw } = makeStore({
      [TOKEN_KEY]: SAMPLE_TOKEN,
      [USER_KEY]:  JSON.stringify(SAMPLE_USER),
    });
    await clearAuthCredentials(adapter);
    const remaining = raw();
    assert.equal(
      TOKEN_KEY in remaining,
      false,
      `TOKEN_KEY (${TOKEN_KEY}) must not remain in store after logout`,
    );
    assert.equal(
      USER_KEY in remaining,
      false,
      `USER_KEY (${USER_KEY}) must not remain in store after logout`,
    );
  });

  it('clearAuthCredentials on an empty store does not throw', async () => {
    const { adapter } = makeStore(); // empty
    await assert.doesNotReject(() => clearAuthCredentials(adapter));
  });

  // ── 7. Full login → logout flow ───────────────────────────────────────────

  it('full login → logout flow: credentials are unreadable after clearAuthCredentials', async () => {
    const { adapter } = makeStore();

    // Simulate successful login
    await saveAuthCredentials(adapter, SAMPLE_TOKEN, SAMPLE_USER);
    const afterLogin = await loadAuthCredentials(adapter);
    assert.ok(afterLogin !== null, 'credentials must be readable after login');
    assert.equal(afterLogin.token, SAMPLE_TOKEN);

    // Simulate logout
    await clearAuthCredentials(adapter);
    const afterLogout = await loadAuthCredentials(adapter);
    assert.equal(
      afterLogout,
      null,
      'credentials must not be readable after logout — both TOKEN_KEY and USER_KEY must be cleared',
    );
  });

  // ── Expired-token scenario ────────────────────────────────────────────────

  it('expired or invalid token: after forced logout, loadAuthCredentials returns null (no silent re-auth)', async () => {
    // Simulate the scenario: app has a stored-but-expired token.
    // The server later signals the token is invalid (e.g. via 401 on an API call).
    // The app must respond by calling clearAuthCredentials so the session
    // cannot be silently "re-used" on the next startup.
    const { adapter } = makeStore({
      [TOKEN_KEY]: 'expired-or-forged-token-xyz',
      [USER_KEY]:  JSON.stringify(SAMPLE_USER),
    });

    // App detects expired token → calls logout equivalent
    await clearAuthCredentials(adapter);

    // On next app startup, loadAuthCredentials must return null
    const result = await loadAuthCredentials(adapter);
    assert.equal(
      result,
      null,
      'After an expired-token logout, no credentials must be loadable on next startup — prevents silent re-authentication',
    );
  });

});
