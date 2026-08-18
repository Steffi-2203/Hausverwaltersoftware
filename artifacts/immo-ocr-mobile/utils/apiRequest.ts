/**
 * Pure helper that constructs and dispatches an authenticated API request.
 *
 * Extracted from AuthContext so it can be tested without a React runtime.
 * AuthContext wraps this with the current token and domain from state.
 */
import { fetchWithTimeout } from './fetchWithTimeout';

export async function apiRequest(
  domain: string,
  token: string | null,
  path: string,
  options: RequestInit = {},
  timeoutMs = 30_000,
): Promise<Response> {
  const url = `https://${domain}${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> ?? {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return fetchWithTimeout(url, { ...options, headers }, timeoutMs);
}
