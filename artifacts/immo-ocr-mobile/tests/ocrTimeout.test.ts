/**
 * Tests for OCR upload timeout behaviour.
 *
 * Tests the real production helpers:
 *   - `utils/apiRequest.ts`  — the function AuthContext.apiRequest delegates to
 *   - `utils/ocrError.ts`    — the function scan.tsx catch-block delegates to
 *
 * Covered scenarios:
 *
 * apiRequest (utils/apiRequest.ts):
 *   1. Hanging fetch fires timeout → throws "Server nicht erreichbar" (German message)
 *   2. Short timeoutMs is respected (does not wait for the 30 s default)
 *   3. Caller-supplied AbortSignal also cancels the request
 *   4. Authorization header is included when a token is provided
 *   5. Authorization header is absent when token is null
 *   6. URL is built as https://{domain}{path}
 *   7. Successful response is returned unchanged (no false positive)
 *
 * handleOcrError (utils/ocrError.ts), i.e. the scan.tsx catch-block:
 *   8.  AbortError from apiRequest → Alert title is "OCR fehlgeschlagen"
 *   9.  AbortError from apiRequest → Alert message contains "Server nicht erreichbar"
 *   10. Generic server error → Alert message reflects the server message
 *   11. err with no message → Alert uses the German fallback phrase
 *   12. End-to-end: hanging fetch → apiRequest throws → handleOcrError routes correct Alert
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { apiRequest }   from '../utils/apiRequest';
import { handleOcrError } from '../utils/ocrError';

// ── Fake-fetch helpers ────────────────────────────────────────────────────────

/** Fetch that never resolves but fires the abort listener. */
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

/** Fetch that resolves immediately with a 200 response and captures call args. */
function makeCapturingFetch(body = '{}', capture: { url?: string; options?: RequestInit } = {}): typeof fetch {
  return (url: any, opts?: RequestInit) => {
    capture.url     = url as string;
    capture.options = opts;
    return Promise.resolve(new Response(body, { status: 200 }));
  };
}

// ── apiRequest (utils/apiRequest.ts) ──────────────────────────────────────────

describe('apiRequest (utils/apiRequest.ts)', () => {

  it('throws "Server nicht erreichbar" when the server hangs past timeoutMs', async () => {
    const realFetch = globalThis.fetch;
    // @ts-ignore
    globalThis.fetch = makeHangingFetch();
    try {
      await assert.rejects(
        () => apiRequest('api.example.com', 'tok-abc', '/api/functions/ocr-invoice', {
          method: 'POST',
          body:   JSON.stringify({ imageBase64: 'abc', mimeType: 'image/jpeg' }),
        }, 1 /* 1 ms — fires immediately */),
        (err: Error) => {
          assert.match(
            err.message,
            /Server nicht erreichbar/,
            'Error message must contain the German phrase from fetchWithTimeout',
          );
          return true;
        },
      );
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('respects the supplied timeoutMs (does not wait for the 30 s default)', async () => {
    const realFetch = globalThis.fetch;
    // @ts-ignore
    globalThis.fetch = makeHangingFetch();
    const start = Date.now();
    try {
      await apiRequest('api.example.com', null, '/api/functions/ocr-invoice', {}, 5).catch(() => {/* expected */});
      const elapsed = Date.now() - start;
      assert.ok(
        elapsed < 500,
        `Expected abort after ~5 ms, elapsed ${elapsed} ms — default timeout may have been used`,
      );
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('aborts when the caller-supplied AbortSignal fires before the timeout', async () => {
    const realFetch = globalThis.fetch;
    // @ts-ignore
    globalThis.fetch = makeHangingFetch();
    try {
      const controller = new AbortController();
      const promise = apiRequest(
        'api.example.com', 'tok', '/api/functions/ocr-invoice',
        { signal: controller.signal },
        10_000, // long timeout — test ends via caller signal
      );
      controller.abort();
      await assert.rejects(() => promise, (err: Error) => {
        assert.match(err.message, /Server nicht erreichbar/);
        return true;
      });
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('attaches Authorization header when a token is provided', async () => {
    const captured: { url?: string; options?: RequestInit } = {};
    const realFetch = globalThis.fetch;
    // @ts-ignore
    globalThis.fetch = makeCapturingFetch('{}', captured);
    try {
      await apiRequest('api.example.com', 'my-token', '/api/test', {}, 5_000);
      const authHeader = (captured.options?.headers as Record<string, string>)?.['Authorization'];
      assert.equal(authHeader, 'Bearer my-token', 'Authorization header must be "Bearer <token>"');
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('omits Authorization header when token is null', async () => {
    const captured: { url?: string; options?: RequestInit } = {};
    const realFetch = globalThis.fetch;
    // @ts-ignore
    globalThis.fetch = makeCapturingFetch('{}', captured);
    try {
      await apiRequest('api.example.com', null, '/api/test', {}, 5_000);
      const headers = (captured.options?.headers ?? {}) as Record<string, string>;
      assert.ok(
        !('Authorization' in headers),
        'Authorization header must be absent when token is null',
      );
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('builds the URL as https://{domain}{path}', async () => {
    const captured: { url?: string; options?: RequestInit } = {};
    const realFetch = globalThis.fetch;
    // @ts-ignore
    globalThis.fetch = makeCapturingFetch('{}', captured);
    try {
      await apiRequest('myapi.example.com', null, '/api/functions/ocr-invoice', {}, 5_000);
      assert.equal(
        captured.url,
        'https://myapi.example.com/api/functions/ocr-invoice',
        'Request URL must be https://{domain}{path}',
      );
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('returns the response unchanged when the server responds in time', async () => {
    const realFetch = globalThis.fetch;
    // @ts-ignore
    globalThis.fetch = makeCapturingFetch('{"data":{},"needs_review":false}');
    try {
      const res = await apiRequest('api.example.com', 'tok', '/api/functions/ocr-invoice', {
        method: 'POST',
        body:   '{}',
      }, 5_000);
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.ok('data' in json, 'Response body must contain "data" field');
    } finally {
      globalThis.fetch = realFetch;
    }
  });

});

// ── handleOcrError (utils/ocrError.ts) / scan.tsx catch-block ─────────────────

describe('handleOcrError (utils/ocrError.ts) — scan.tsx catch-block routing', () => {

  it('passes alert title "OCR fehlgeschlagen" for a timeout error', () => {
    const timeoutErr = new Error('Server nicht erreichbar – bitte Verbindung prüfen.');
    let capturedTitle = '';
    handleOcrError(timeoutErr, (title) => { capturedTitle = title; });
    assert.equal(capturedTitle, 'OCR fehlgeschlagen');
  });

  it('alert message contains "Server nicht erreichbar" for a timeout error', () => {
    const timeoutErr = new Error('Server nicht erreichbar – bitte Verbindung prüfen.');
    let capturedMessage = '';
    handleOcrError(timeoutErr, (_title, message) => { capturedMessage = message; });
    assert.match(
      capturedMessage,
      /Server nicht erreichbar/,
      'Alert message must propagate the German timeout phrase from fetchWithTimeout',
    );
  });

  it('alert message reflects server error text (not the timeout phrase)', () => {
    const serverErr = new Error('Serverfehler (500)');
    let capturedMessage = '';
    handleOcrError(serverErr, (_t, message) => { capturedMessage = message; });
    assert.match(capturedMessage, /Serverfehler/);
    assert.doesNotMatch(
      capturedMessage,
      /Server nicht erreichbar/,
      'A generic server error must not show the timeout phrase',
    );
  });

  it('uses the German fallback phrase when err has no message (null / undefined error)', () => {
    let capturedMessage = '';
    handleOcrError(null, (_t, message) => { capturedMessage = message; });
    assert.match(
      capturedMessage,
      /Die Rechnung konnte nicht analysiert werden/,
      'Null error must produce the default German fallback',
    );
  });

  it('provides exactly one OK button', () => {
    const buttons: any[] = [];
    handleOcrError(new Error('test'), (_t, _m, btns) => { buttons.push(...btns); });
    assert.equal(buttons.length, 1);
    assert.equal(buttons[0].text, 'OK');
  });

  it('end-to-end: hanging fetch → apiRequest throws → handleOcrError shows correct Alert', async () => {
    const realFetch = globalThis.fetch;
    // @ts-ignore
    globalThis.fetch = makeHangingFetch();

    let alertTitle   = '';
    let alertMessage = '';

    try {
      // This replicates the full call path:
      //   AuthContext.apiRequest → _apiRequest (utils/apiRequest.ts) → fetchWithTimeout
      await apiRequest('api.example.com', 'tok', '/api/functions/ocr-invoice', {}, 1);
    } catch (err: any) {
      // This replicates what scan.tsx does in the catch block:
      //   handleOcrError(err, (t, m, b) => Alert.alert(t, m, b));
      handleOcrError(err, (title, message) => {
        alertTitle   = title;
        alertMessage = message;
      });
    } finally {
      globalThis.fetch = realFetch;
    }

    assert.equal(alertTitle, 'OCR fehlgeschlagen', 'Alert title must be "OCR fehlgeschlagen"');
    assert.match(
      alertMessage,
      /Server nicht erreichbar/,
      'Alert message must contain the German timeout phrase from fetchWithTimeout → apiRequest → handleOcrError',
    );
  });

});
