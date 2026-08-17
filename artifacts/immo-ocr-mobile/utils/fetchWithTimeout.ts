/**
 * Wraps `fetch` with an automatic abort timeout.
 * If the caller also passes `options.signal`, both signals are composed so that
 * either the timeout *or* the caller-supplied abort cancels the request.
 *
 * Throws `new Error('Server nicht erreichbar – bitte Verbindung prüfen.')`
 * on AbortError so callers get a consistent German message without needing to
 * handle AbortError themselves.
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = 30_000,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), timeoutMs);

  // Compose caller-supplied signal with the timeout signal.
  const signals: AbortSignal[] = [controller.signal];
  if (options.signal instanceof AbortSignal) signals.push(options.signal);
  const composedSignal = signals.length > 1
    ? AbortSignal.any(signals)
    : controller.signal;

  try {
    return await fetch(url, { ...options, signal: composedSignal });
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new Error('Server nicht erreichbar – bitte Verbindung prüfen.');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}
