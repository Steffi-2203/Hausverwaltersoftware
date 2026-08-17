/**
 * Platform-branching logic for the scan screen's gallery and camera actions.
 *
 * Extracted from scan.tsx so it can be unit-tested without a React Native
 * runtime.  Every external side-effect is injected via dependency objects,
 * keeping this module import-free of React Native / Expo packages.
 *
 * Covered contracts
 * ─────────────────
 * openGallery(platform, …)
 *   - 'web'    → clickGalleryInput() is called; native pickers are NOT called
 *   - native   → requestAndLaunch(false, …) is called; clickGalleryInput NOT called
 *
 * openCamera(platform, …)
 *   - 'web'    → clickCameraInput() is called; native pickers are NOT called
 *   - native   → requestAndLaunch(true, …) is called; clickCameraInput NOT called
 *
 * WEB_INPUT_CONFIG
 *   - gallery: no `capture` attribute (browser opens photo library)
 *   - camera:  `capture="environment"` (mobile browser opens rear camera)
 */

import { requestAndLaunch } from './galleryUtils';
import type { NativeDeps } from './galleryUtils';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WebDeps {
  /** Trigger the hidden gallery <input type="file"> (no capture attribute). */
  clickGalleryInput: () => void;
  /** Trigger the hidden camera <input type="file" capture="environment">. */
  clickCameraInput: () => void;
}

// ─── Web file-input attribute contract ───────────────────────────────────────

/**
 * Documents the expected HTML attributes for the two hidden file inputs
 * rendered on web.  Tests import this to assert the contract without
 * rendering the full component.
 */
export const WEB_INPUT_CONFIG = {
  gallery: {
    type: 'file' as const,
    accept: 'image/*' as const,
    /** Gallery input must NOT have a capture attribute. */
    capture: undefined as string | undefined,
  },
  camera: {
    type: 'file' as const,
    accept: 'image/*' as const,
    /** Camera input MUST use capture="environment" to target the rear camera. */
    capture: 'environment' as const,
  },
} as const;

// ─── Actions ─────────────────────────────────────────────────────────────────

/**
 * Opens the gallery.
 *
 * On web:    clicks the hidden <input> (no capture) so the browser's file
 *            picker / photo library opens.
 * On native: requests media-library permission, then launches the native
 *            image-library picker via ImagePicker.launchImageLibraryAsync.
 */
export async function openGallery(
  platform: string,
  webDeps: WebDeps,
  nativeDeps: NativeDeps,
): Promise<void> {
  if (platform === 'web') {
    webDeps.clickGalleryInput();
  } else {
    await requestAndLaunch(false, nativeDeps);
  }
}

/**
 * Opens the camera.
 *
 * On web:    clicks the hidden <input capture="environment"> so mobile
 *            browsers open the device camera directly.
 * On native: requests camera permission, then launches the native camera
 *            via ImagePicker.launchCameraAsync.
 */
export async function openCamera(
  platform: string,
  webDeps: WebDeps,
  nativeDeps: NativeDeps,
): Promise<void> {
  if (platform === 'web') {
    webDeps.clickCameraInput();
  } else {
    await requestAndLaunch(true, nativeDeps);
  }
}
