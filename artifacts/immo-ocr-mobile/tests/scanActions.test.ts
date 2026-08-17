/**
 * Platform-branching tests for the scan screen's gallery / camera actions.
 *
 * Uses node:test — no React Native runtime required.
 *
 * Covered scenarios
 * ─────────────────
 * Web platform (Platform.OS === 'web')
 *   1.  openGallery on web → clickGalleryInput() is called
 *   2.  openGallery on web → launchImageLibraryAsync is NOT called
 *   3.  openGallery on web → launchCameraAsync is NOT called
 *   4.  openCamera  on web → clickCameraInput() is called
 *   5.  openCamera  on web → launchCameraAsync is NOT called
 *   6.  openCamera  on web → launchImageLibraryAsync is NOT called
 *
 * Native platforms (ios / android)
 *   7.  openGallery on native → launchImageLibrary is called (not camera)
 *   8.  openGallery on native → clickGalleryInput is NOT called
 *   9.  openCamera  on native → launchCamera is called (not gallery)
 *   10. openCamera  on native → clickCameraInput is NOT called
 *
 * Web file-input attribute contract
 *   11. Gallery input has NO capture attribute
 *   12. Camera  input has capture === 'environment'
 *   13. Both inputs have type === 'file' and accept === 'image/*'
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { openGallery, openCamera, WEB_INPUT_CONFIG } from '../utils/scanActions';
import type { NativeDeps } from '../utils/galleryUtils';
import type { WebDeps } from '../utils/scanActions';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeWebDeps(): WebDeps & { calls: { gallery: number; camera: number } } {
  const calls = { gallery: 0, camera: 0 };
  return {
    clickGalleryInput: () => { calls.gallery++; },
    clickCameraInput:  () => { calls.camera++; },
    calls,
  };
}

function makeNativeDeps(): NativeDeps & {
  calls: {
    processOcr:    number;
    showAlert:     number;
    launchGallery: number;
    launchCamera:  number;
  };
} {
  const calls = { processOcr: 0, showAlert: 0, launchGallery: 0, launchCamera: 0 };
  return {
    processOcr: async () => { calls.processOcr++; },
    requestMediaLibraryPermissions: async () => ({ granted: true }),
    requestCameraPermissions:       async () => ({ granted: true }),
    launchImageLibrary: async () => { calls.launchGallery++; return { canceled: true }; },
    launchCamera:       async () => { calls.launchCamera++;  return { canceled: true }; },
    showAlert: () => { calls.showAlert++; },
    calls,
  };
}

// ─── Web platform ─────────────────────────────────────────────────────────────

describe('openGallery — web platform', () => {

  it('calls clickGalleryInput when Platform.OS is "web"', async () => {
    const web    = makeWebDeps();
    const native = makeNativeDeps();

    await openGallery('web', web, native);

    assert.equal(web.calls.gallery, 1, 'clickGalleryInput must be called exactly once');
  });

  it('does NOT call launchImageLibraryAsync when Platform.OS is "web"', async () => {
    const web    = makeWebDeps();
    const native = makeNativeDeps();

    await openGallery('web', web, native);

    assert.equal(
      native.calls.launchGallery,
      0,
      'launchImageLibraryAsync must NOT be called on web',
    );
  });

  it('does NOT call launchCameraAsync when Platform.OS is "web"', async () => {
    const web    = makeWebDeps();
    const native = makeNativeDeps();

    await openGallery('web', web, native);

    assert.equal(
      native.calls.launchCamera,
      0,
      'launchCameraAsync must NOT be called on web',
    );
  });

});

describe('openCamera — web platform', () => {

  it('calls clickCameraInput when Platform.OS is "web"', async () => {
    const web    = makeWebDeps();
    const native = makeNativeDeps();

    await openCamera('web', web, native);

    assert.equal(web.calls.camera, 1, 'clickCameraInput must be called exactly once');
  });

  it('does NOT call launchCameraAsync when Platform.OS is "web"', async () => {
    const web    = makeWebDeps();
    const native = makeNativeDeps();

    await openCamera('web', web, native);

    assert.equal(
      native.calls.launchCamera,
      0,
      'launchCameraAsync must NOT be called on web',
    );
  });

  it('does NOT call launchImageLibraryAsync when Platform.OS is "web"', async () => {
    const web    = makeWebDeps();
    const native = makeNativeDeps();

    await openCamera('web', web, native);

    assert.equal(
      native.calls.launchGallery,
      0,
      'launchImageLibraryAsync must NOT be called on web',
    );
  });

  it('does NOT call clickGalleryInput when opening the camera on web', async () => {
    const web    = makeWebDeps();
    const native = makeNativeDeps();

    await openCamera('web', web, native);

    assert.equal(web.calls.gallery, 0, 'gallery input must NOT be triggered when opening camera');
  });

});

// ─── Native platforms ─────────────────────────────────────────────────────────

describe('openGallery — native platform (ios / android)', () => {

  for (const platform of ['ios', 'android']) {
    it(`calls launchImageLibrary (not camera) on ${platform}`, async () => {
      const web    = makeWebDeps();
      const native = makeNativeDeps();

      await openGallery(platform, web, native);

      assert.equal(native.calls.launchGallery, 1,  'launchImageLibrary must be called once');
      assert.equal(native.calls.launchCamera,  0,  'launchCamera must NOT be called');
    });

    it(`does NOT call clickGalleryInput on ${platform}`, async () => {
      const web    = makeWebDeps();
      const native = makeNativeDeps();

      await openGallery(platform, web, native);

      assert.equal(web.calls.gallery, 0, 'clickGalleryInput must NOT be called on native');
      assert.equal(web.calls.camera,  0, 'clickCameraInput must NOT be called on native');
    });
  }

});

describe('openCamera — native platform (ios / android)', () => {

  for (const platform of ['ios', 'android']) {
    it(`calls launchCamera (not gallery) on ${platform}`, async () => {
      const web    = makeWebDeps();
      const native = makeNativeDeps();

      await openCamera(platform, web, native);

      assert.equal(native.calls.launchCamera,  1, 'launchCamera must be called once');
      assert.equal(native.calls.launchGallery, 0, 'launchImageLibrary must NOT be called');
    });

    it(`does NOT call clickCameraInput on ${platform}`, async () => {
      const web    = makeWebDeps();
      const native = makeNativeDeps();

      await openCamera(platform, web, native);

      assert.equal(web.calls.camera,  0, 'clickCameraInput must NOT be called on native');
      assert.equal(web.calls.gallery, 0, 'clickGalleryInput must NOT be called on native');
    });
  }

});

// ─── Web file-input attribute contract ───────────────────────────────────────

describe('WEB_INPUT_CONFIG — file input attribute contract', () => {

  it('gallery input has NO capture attribute', () => {
    assert.equal(
      WEB_INPUT_CONFIG.gallery.capture,
      undefined,
      'gallery file input must not have a capture attribute so the browser opens the photo library',
    );
  });

  it('camera input has capture === "environment"', () => {
    assert.equal(
      WEB_INPUT_CONFIG.camera.capture,
      'environment',
      'camera file input must have capture="environment" to open the rear-facing camera on mobile browsers',
    );
  });

  it('gallery input has type "file" and accept "image/*"', () => {
    assert.equal(WEB_INPUT_CONFIG.gallery.type,   'file');
    assert.equal(WEB_INPUT_CONFIG.gallery.accept, 'image/*');
  });

  it('camera input has type "file" and accept "image/*"', () => {
    assert.equal(WEB_INPUT_CONFIG.camera.type,   'file');
    assert.equal(WEB_INPUT_CONFIG.camera.accept, 'image/*');
  });

  it('gallery and camera capture values are distinct', () => {
    assert.notEqual(
      WEB_INPUT_CONFIG.gallery.capture,
      WEB_INPUT_CONFIG.camera.capture,
      'gallery and camera inputs must differ in their capture attribute',
    );
  });

});
