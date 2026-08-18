/**
 * loginRequest – pure network layer for the login flow.
 *
 * Separated from AuthContext so it can be unit-tested without a React
 * environment.  All timing and fetch behaviour can be injected for tests.
 */

export interface LoginResponse {
  token:          string;
  id:             string;
  email:          string;
  fullName:       string;
  organizationId: string;
}

export interface LoginRequestOptions {
  /**
   * Abort the request after this many milliseconds.
   * Defaults to EXPO_PUBLIC_LOGIN_TIMEOUT_MS (env var) or 10 000 ms.
   */
  timeoutMs?: number;
  /** Injectable fetch function; defaults to globalThis.fetch. */
  fetchFn?: typeof fetch;
}

/**
 * Default login timeout in milliseconds.
 * Reads EXPO_PUBLIC_LOGIN_TIMEOUT_MS at module load time; falls back to 10 000.
 */
const DEFAULT_LOGIN_TIMEOUT_MS = (() => {
  const raw = process.env.EXPO_PUBLIC_LOGIN_TIMEOUT_MS;
  const parsed = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10_000;
})();

/**
 * Perform a login POST request.
 *
 * @throws {Error} with message "Server nicht erreichbar – bitte Verbindung prüfen."
 *   when the request times out or the network is unreachable.
 * @throws {Error} with message "Zwei-Faktor-Authentifizierung erforderlich. …"
 *   when the server signals 2FA is needed.
 * @throws {Error} with `data.error` (or "Anmeldung fehlgeschlagen") for other
 *   non-OK responses.
 */
export async function loginRequest(
  url:      string,
  email:    string,
  password: string,
  opts:     LoginRequestOptions = {},
): Promise<LoginResponse> {
  const {
    timeoutMs = DEFAULT_LOGIN_TIMEOUT_MS,
    fetchFn   = globalThis.fetch,
  } = opts;

  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetchFn(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email, password }),
      signal:  controller.signal,
    });
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new Error('Server nicht erreichbar – bitte Verbindung prüfen.');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error ?? 'Anmeldung fehlgeschlagen');
  }

  if (data.requires2FA) {
    throw new Error(
      'Zwei-Faktor-Authentifizierung erforderlich. Bitte zuerst im Browser anmelden.',
    );
  }

  return {
    token:          data.token as string,
    id:             data.id   as string,
    email:          data.email as string,
    fullName:       (data.fullName ?? data.full_name ?? email) as string,
    organizationId: (data.organizationId ?? data.organization_id ?? '') as string,
  };
}
