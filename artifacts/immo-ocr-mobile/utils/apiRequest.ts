/**
 * Pure helper that constructs and dispatches an authenticated API request.
 *
 * Extracted from AuthContext so it can be tested without a React runtime.
 * AuthContext wraps this with the current token and domain from state.
 *
 * When the server returns 401, `onUnauthorized` is called (if supplied) so
 * the caller (AuthContext) can clear SecureStore and update React state
 * atomically. The 401 Response is still returned to the caller unchanged.
 */
import { fetchWithTimeout } from './fetchWithTimeout';

export async function apiRequest(
  domain:          string,
  token:           string | null,
  path:            string,
  options:         RequestInit = {},
  timeoutMs      = 30_000,
  onUnauthorized?: () => void | Promise<void>,
): Promise<Response> {
  const url = `https://${domain}${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> ?? {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetchWithTimeout(url, { ...options, headers }, timeoutMs);
  if (res.status === 401 && onUnauthorized) {
    // Fire-and-forget (don't await): lets the caller chain .then()/.catch()
    // on the returned response without blocking on the state cleanup.
    void Promise.resolve(onUnauthorized());
  }
  return res;
}
