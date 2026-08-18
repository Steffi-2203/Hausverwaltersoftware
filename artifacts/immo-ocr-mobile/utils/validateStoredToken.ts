/**
 * validateStoredToken – startup token validation.
 *
 * Loads credentials from storage and checks them against the server.
 * If the server returns 401 (expired or forged token), the credentials
 * are cleared atomically so the next app startup stays logged out.
 *
 * Network errors (timeouts, offline) are treated as "assume valid" — the
 * token is not cleared because the user might be offline; actual API calls
 * will fail gracefully.
 *
 * Injectable: accepts a StorageAdapter and a fetchFn so tests can run
 * without expo-secure-store, a real server, or a React environment.
 */

import { loadAuthCredentials, clearAuthCredentials, type StorageAdapter, type StoredAuthUser } from './authStorage';

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export interface ValidateResult {
  /** True when the token is confirmed valid or when network is unavailable (offline). */
  valid: boolean;
  token: string | null;
  user:  StoredAuthUser | null;
}

/**
 * Validate the stored bearer token against the server.
 *
 * @param store       Storage adapter (SecureStore in production, in-memory in tests).
 * @param fetchFn     Fetch implementation; use a fake in tests.
 * @param validateUrl Full URL of the lightweight validate endpoint (e.g. `https://example.com/api/auth/validate`).
 * @param timeoutMs   Request timeout in milliseconds (default 5 000).
 */
export async function validateStoredToken(
  store:       StorageAdapter,
  fetchFn:     FetchFn,
  validateUrl: string,
  timeoutMs  = 5_000,
): Promise<ValidateResult> {
  const credentials = await loadAuthCredentials(store);
  if (!credentials) {
    return { valid: false, token: null, user: null };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchFn(validateUrl, {
      method:  'GET',
      headers: {
        'Authorization': `Bearer ${credentials.token}`,
        'Content-Type':  'application/json',
      },
      signal: controller.signal,
    });

    if (res.status === 401 || res.status === 403) {
      // Token definitively rejected — clear immediately so the next startup
      // starts from a clean state.
      await clearAuthCredentials(store);
      return { valid: false, token: null, user: null };
    }

    if (res.status >= 200 && res.status < 300) {
      // Server explicitly confirmed the token is valid.
      return { valid: true, token: credentials.token, user: credentials.user };
    }

    if (res.status >= 500) {
      // Server error (5xx): the server did not intentionally reject the token.
      // Preserve offline grace — keep credentials and enter auth state so the
      // user can still use the app; actual API calls will fail gracefully or
      // recover when the server comes back.
      return { valid: true, token: credentials.token, user: credentials.user };
    }

    // 429 (rate-limit) and any other 4xx the server returned deliberately:
    // The server didn't confirm validity. Preserve credentials in SecureStore
    // (they may still be good once the rate-limit lifts) but do NOT enter
    // authenticated state — the token has not been verified.
    return { valid: false, token: null, user: null };

  } catch {
    // Network error or timeout — treat as "assume valid / offline".
    // The token is NOT cleared: the user might simply be offline.
    return { valid: true, token: credentials.token, user: credentials.user };
  } finally {
    clearTimeout(timer);
  }
}
