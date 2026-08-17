/**
 * Gallery-access tests (node:test, no React Native runtime needed).
 *
 * Covered scenarios
 * ─────────────────
 * Web path (handleDataUrl)
 *   1. base64 prefix is stripped correctly
 *   2. MIME type from the File object is forwarded to processOcr
 *   3. Falls back to 'image/jpeg' when file.type is empty
 *   4. processOcr is called exactly once per file
 *   5. resetInput callback is invoked (allows the same file to be re-selected)
 *
 * Native path (requestAndLaunch)
 *   6.  Permission denied (gallery) → Alert shown, launchImageLibrary NOT called
 *   7.  Alert title contains "Berechtigung erforderlich"
 *   8.  Alert buttons include "Einstellungen öffnen"
 *   9.  Permission granted (gallery) → launchImageLibrary called
 *   10. Picker cancelled → processOcr NOT called
 *   11. Asset returned without base64 → error Alert shown, processOcr NOT called
 *   12. Asset returned with base64 → processOcr called with correct args
 *   13. Permission denied (camera) → Alert shown, launchCamera NOT called
 *   14. Permission granted (camera) → launchCamera called
 *   15. Asset mimeType falls back to 'image/jpeg' when undefined
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { handleDataUrl, requestAndLaunch } from '../utils/galleryUtils';
import type { NativeDeps } from '../utils/galleryUtils';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build a minimal NativeDeps stub; override individual fields as needed. */
function makeDeps(overrides: Partial<NativeDeps> = {}): NativeDeps & {
  calls: {
    processOcr:   Parameters<NativeDeps['processOcr']>[];
    showAlert:    Parameters<NativeDeps['showAlert']>[];
    launchGallery: number;
    launchCamera:  number;
  };
} {
  const calls = {
    processOcr:    [] as Parameters<NativeDeps['processOcr']>[],
    showAlert:     [] as Parameters<NativeDeps['showAlert']>[],
    launchGallery: 0,
    launchCamera:  0,
  };

  const defaults: NativeDeps = {
    processOcr: async (...args) => { calls.processOcr.push(args); },
    requestMediaLibraryPermissions: async () => ({ granted: true }),
    requestCameraPermissions:       async () => ({ granted: true }),
    launchImageLibrary: async () => {
      calls.launchGallery++;
      return { canceled: true };
    },
    launchCamera: async () => {
      calls.launchCamera++;
      return { canceled: true };
    },
    showAlert: (title, message, buttons) => {
      calls.showAlert.push([title, message, buttons]);
    },
  };

  return { ...defaults, ...overrides, calls };
}

// ─── Web path: handleDataUrl ──────────────────────────────────────────────────

describe('handleDataUrl (web file-input path)', () => {

  it('strips the data-URL prefix and forwards pure base64 to processOcr', async () => {
    const received: string[] = [];
    const dataUrl = 'data:image/png;base64,iVBORw0KGgo=';

    await handleDataUrl(dataUrl, 'image/png', async (b64) => { received.push(b64); });

    assert.equal(received.length, 1, 'processOcr must be called once');
    assert.equal(received[0], 'iVBORw0KGgo=', 'base64 should not contain the prefix');
    assert.ok(!received[0].includes(','), 'no comma should remain in the base64 string');
  });

  it('forwards the full dataUrl as imageUri', async () => {
    const dataUrl = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
    let capturedUri = '';

    await handleDataUrl(dataUrl, 'image/jpeg', async (_b64, uri) => { capturedUri = uri; });

    assert.equal(capturedUri, dataUrl);
  });

  it('passes the file MIME type to processOcr', async () => {
    let capturedMime = '';
    const dataUrl = 'data:image/webp;base64,UklGRg==';

    await handleDataUrl(dataUrl, 'image/webp', async (_b64, _uri, mime) => { capturedMime = mime; });

    assert.equal(capturedMime, 'image/webp');
  });

  it("falls back to 'image/jpeg' when fileType is empty", async () => {
    let capturedMime = '';

    await handleDataUrl('data:;base64,abc', '', async (_b64, _uri, mime) => { capturedMime = mime; });

    assert.equal(capturedMime, 'image/jpeg');
  });

  it('calls processOcr exactly once per invocation', async () => {
    let count = 0;
    await handleDataUrl('data:image/png;base64,abc', 'image/png', async () => { count++; });
    assert.equal(count, 1);
  });

  it('invokes the optional resetInput callback', async () => {
    let resetCalled = false;
    await handleDataUrl(
      'data:image/png;base64,abc',
      'image/png',
      async () => {},
      () => { resetCalled = true; },
    );
    assert.ok(resetCalled, 'resetInput must be called so the same file can be re-selected');
  });

  it('does not throw when resetInput is not provided', async () => {
    await assert.doesNotReject(
      () => handleDataUrl('data:image/png;base64,abc', 'image/png', async () => {}),
    );
  });
});

// ─── Native path: requestAndLaunch ───────────────────────────────────────────

describe('requestAndLaunch — gallery (useCamera=false)', () => {

  it('shows Alert and does NOT launch picker when permission is denied', async () => {
    const deps = makeDeps({
      requestMediaLibraryPermissions: async () => ({ granted: false }),
    });

    await requestAndLaunch(false, deps);

    assert.equal(deps.calls.showAlert.length, 1,    'Alert must be shown once');
    assert.equal(deps.calls.launchGallery, 0,        'picker must NOT be launched');
    assert.equal(deps.calls.processOcr.length, 0,   'processOcr must NOT be called');
  });

  it('Alert title is "Berechtigung erforderlich" on denial', async () => {
    const deps = makeDeps({
      requestMediaLibraryPermissions: async () => ({ granted: false }),
    });

    await requestAndLaunch(false, deps);

    const [title] = deps.calls.showAlert[0];
    assert.equal(title, 'Berechtigung erforderlich');
  });

  it('Alert buttons include "Einstellungen öffnen" on denial', async () => {
    const deps = makeDeps({
      requestMediaLibraryPermissions: async () => ({ granted: false }),
    });

    await requestAndLaunch(false, deps);

    const buttons = deps.calls.showAlert[0][2];
    const labels  = buttons.map(b => b.text);
    assert.ok(
      labels.includes('Einstellungen öffnen'),
      `Expected "Einstellungen öffnen" in buttons, got: ${JSON.stringify(labels)}`,
    );
  });

  it('launches gallery picker when permission is granted', async () => {
    const deps = makeDeps({ requestMediaLibraryPermissions: async () => ({ granted: true }) });

    await requestAndLaunch(false, deps);

    assert.equal(deps.calls.launchGallery, 1, 'launchImageLibrary must be called once');
    assert.equal(deps.calls.launchCamera,  0, 'launchCamera must NOT be called');
  });

  it('does NOT call processOcr when picker is cancelled', async () => {
    const deps = makeDeps({
      requestMediaLibraryPermissions: async () => ({ granted: true }),
      launchImageLibrary: async () => ({ canceled: true, assets: [] }),
    });

    await requestAndLaunch(false, deps);

    assert.equal(deps.calls.processOcr.length, 0);
  });

  it('shows error Alert and skips processOcr when asset has no base64', async () => {
    const deps = makeDeps({
      requestMediaLibraryPermissions: async () => ({ granted: true }),
      launchImageLibrary: async () => ({
        canceled: false,
        assets: [{ uri: 'file://img.jpg', base64: undefined, mimeType: 'image/jpeg' }],
      }),
    });

    await requestAndLaunch(false, deps);

    assert.equal(deps.calls.processOcr.length, 0, 'processOcr must NOT be called');
    assert.equal(deps.calls.showAlert.length, 1,   'error Alert must be shown');
  });

  it('calls processOcr with correct base64, uri, and mimeType', async () => {
    const deps = makeDeps({
      requestMediaLibraryPermissions: async () => ({ granted: true }),
      launchImageLibrary: async () => ({
        canceled: false,
        assets: [{ uri: 'file://photo.jpg', base64: 'abc123', mimeType: 'image/jpeg' }],
      }),
    });

    await requestAndLaunch(false, deps);

    assert.equal(deps.calls.processOcr.length, 1);
    const [b64, uri, mime] = deps.calls.processOcr[0];
    assert.equal(b64,  'abc123');
    assert.equal(uri,  'file://photo.jpg');
    assert.equal(mime, 'image/jpeg');
  });

  it("falls back to 'image/jpeg' when asset.mimeType is undefined", async () => {
    const deps = makeDeps({
      requestMediaLibraryPermissions: async () => ({ granted: true }),
      launchImageLibrary: async () => ({
        canceled: false,
        assets: [{ uri: 'file://photo.jpg', base64: 'xyz', mimeType: undefined }],
      }),
    });

    await requestAndLaunch(false, deps);

    assert.equal(deps.calls.processOcr.length, 1);
    assert.equal(deps.calls.processOcr[0][2], 'image/jpeg');
  });
});

describe('requestAndLaunch — null base64 (Expo-specific)', () => {

  it('shows error Alert and skips processOcr when asset.base64 is null (not undefined)', async () => {
    const deps = makeDeps({
      requestMediaLibraryPermissions: async () => ({ granted: true }),
      launchImageLibrary: async () => ({
        canceled: false,
        assets: [{ uri: 'file://img.jpg', base64: null, mimeType: 'image/jpeg' }],
      }),
    });

    await requestAndLaunch(false, deps);

    assert.equal(deps.calls.processOcr.length, 0, 'processOcr must NOT be called for null base64');
    assert.equal(deps.calls.showAlert.length, 1, 'error Alert must be shown');
  });

});

describe('requestAndLaunch — rejection / operational errors', () => {

  it('shows error Alert when requestMediaLibraryPermissions rejects', async () => {
    const deps = makeDeps({
      requestMediaLibraryPermissions: async () => {
        throw new Error('Hardware unavailable');
      },
    });

    await requestAndLaunch(false, deps);

    assert.equal(deps.calls.showAlert.length, 1, 'error Alert must be shown');
    const [title, message] = deps.calls.showAlert[0];
    assert.equal(title, 'Fehler');
    assert.ok(
      message.includes('Hardware unavailable'),
      `Alert message should contain the error text, got: ${message}`,
    );
    assert.equal(deps.calls.processOcr.length, 0);
  });

  it('shows error Alert when launchImageLibrary rejects', async () => {
    const deps = makeDeps({
      requestMediaLibraryPermissions: async () => ({ granted: true }),
      launchImageLibrary: async () => {
        throw new Error('Picker crashed');
      },
    });

    await requestAndLaunch(false, deps);

    assert.equal(deps.calls.showAlert.length, 1);
    const [title, message] = deps.calls.showAlert[0];
    assert.equal(title, 'Fehler');
    assert.ok(message.includes('Picker crashed'));
    assert.equal(deps.calls.processOcr.length, 0);
  });

  it('shows error Alert when requestCameraPermissions rejects', async () => {
    const deps = makeDeps({
      requestCameraPermissions: async () => {
        throw new Error('Camera module not found');
      },
    });

    await requestAndLaunch(true, deps);

    assert.equal(deps.calls.showAlert.length, 1);
    const [title] = deps.calls.showAlert[0];
    assert.equal(title, 'Fehler');
    assert.equal(deps.calls.processOcr.length, 0);
  });

  it('shows error Alert when launchCamera rejects', async () => {
    const deps = makeDeps({
      requestCameraPermissions: async () => ({ granted: true }),
      launchCamera: async () => {
        throw new Error('Camera failed');
      },
    });

    await requestAndLaunch(true, deps);

    assert.equal(deps.calls.showAlert.length, 1);
    assert.equal(deps.calls.processOcr.length, 0);
  });

  it('does not let a non-Error rejection bypass the error Alert', async () => {
    const deps = makeDeps({
      requestMediaLibraryPermissions: async () => ({ granted: true }),
      launchImageLibrary: async () => { throw 'string rejection'; },
    });

    await requestAndLaunch(false, deps);

    assert.equal(deps.calls.showAlert.length, 1);
    const [title, message] = deps.calls.showAlert[0];
    assert.equal(title, 'Fehler');
    assert.ok(message.includes('Unbekannter Fehler'));
  });

});

describe('requestAndLaunch — camera (useCamera=true)', () => {

  it('shows Alert and does NOT launch camera when permission is denied', async () => {
    const deps = makeDeps({
      requestCameraPermissions: async () => ({ granted: false }),
    });

    await requestAndLaunch(true, deps);

    assert.equal(deps.calls.showAlert.length, 1,   'Alert must be shown once');
    assert.equal(deps.calls.launchCamera,  0,        'launchCamera must NOT be called');
    assert.equal(deps.calls.launchGallery, 0,        'launchImageLibrary must NOT be called');
    assert.equal(deps.calls.processOcr.length, 0,   'processOcr must NOT be called');
  });

  it('launches camera (not gallery) when permission is granted', async () => {
    const deps = makeDeps({ requestCameraPermissions: async () => ({ granted: true }) });

    await requestAndLaunch(true, deps);

    assert.equal(deps.calls.launchCamera,  1, 'launchCamera must be called once');
    assert.equal(deps.calls.launchGallery, 0, 'launchImageLibrary must NOT be called');
  });

  it('calls processOcr with correct args when camera returns an asset', async () => {
    const deps = makeDeps({
      requestCameraPermissions: async () => ({ granted: true }),
      launchCamera: async () => ({
        canceled: false,
        assets: [{ uri: 'file://cam.jpg', base64: 'camBase64', mimeType: 'image/png' }],
      }),
    });

    await requestAndLaunch(true, deps);

    assert.equal(deps.calls.processOcr.length, 1);
    const [b64, uri, mime] = deps.calls.processOcr[0];
    assert.equal(b64,  'camBase64');
    assert.equal(uri,  'file://cam.jpg');
    assert.equal(mime, 'image/png');
  });
});
