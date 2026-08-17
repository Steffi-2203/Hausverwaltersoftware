/**
 * Pure gallery-access logic extracted from scan.tsx so it can be
 * unit-tested without a React Native runtime.
 *
 * The module exports two functions:
 *  - handleDataUrl   – strips the base64 prefix from a FileReader result
 *                      and forwards to processOcr (web path)
 *  - requestAndLaunch – asks for permissions and launches the native picker
 *                       (native path); all side-effects are injected so tests
 *                       can pass mocks without importing expo packages.
 */

export type ProcessOcrFn = (
  base64: string,
  imageUri: string,
  mimeType: string,
) => Promise<void>;

export interface AlertButton {
  text: string;
  style?: 'cancel' | 'destructive' | 'default';
  onPress?: () => void;
}

export interface NativeDeps {
  processOcr: ProcessOcrFn;
  /** resolves to { granted: boolean } */
  requestMediaLibraryPermissions: () => Promise<{ granted: boolean }>;
  /** resolves to { granted: boolean } */
  requestCameraPermissions: () => Promise<{ granted: boolean }>;
  /** wraps ImagePicker.launchImageLibraryAsync — base64 and assets may be null per Expo spec */
  launchImageLibrary: (options: object) => Promise<{
    canceled: boolean;
    assets?: Array<{
      base64?: string | null;
      uri: string;
      mimeType?: string;
    }> | null;
  }>;
  /** wraps ImagePicker.launchCameraAsync — base64 and assets may be null per Expo spec */
  launchCamera: (options: object) => Promise<{
    canceled: boolean;
    assets?: Array<{
      base64?: string | null;
      uri: string;
      mimeType?: string;
    }> | null;
  }>;
  /** wraps Alert.alert */
  showAlert: (title: string, message: string, buttons: AlertButton[]) => void;
}

// ─── Web path ────────────────────────────────────────────────────────────────

/** Maximum file size accepted by the web upload path (15 MB). */
export const MAX_WEB_FILE_BYTES = 15 * 1024 * 1024; // 15 MB

/**
 * Validates the size of a file selected via the web file input.
 *
 * Returns a human-readable German error message when the file exceeds
 * `maxBytes` (defaults to MAX_WEB_FILE_BYTES), or `null` when the size
 * is within the allowed range.
 */
export function validateWebFileSize(
  fileSize: number,
  maxBytes: number = MAX_WEB_FILE_BYTES,
): string | null {
  if (fileSize > maxBytes) {
    const limitMB = Math.round(maxBytes / (1024 * 1024));
    return `Die Datei ist zu groß (maximal ${limitMB} MB). Bitte wählen Sie ein kleineres Bild.`;
  }
  return null;
}

/**
 * Called once a FileReader has produced a data URL.
 * Strips the "data:<mime>;base64," prefix, resolves the MIME type,
 * optionally resets the file input, then forwards everything to processOcr.
 */
export async function handleDataUrl(
  dataUrl: string,
  fileType: string,
  processOcr: ProcessOcrFn,
  resetInput?: () => void,
): Promise<void> {
  const commaIdx = dataUrl.indexOf(',');
  const base64   = dataUrl.substring(commaIdx + 1);
  const mimeType = fileType || 'image/jpeg';
  resetInput?.();
  await processOcr(base64, dataUrl, mimeType);
}

// ─── Native path ─────────────────────────────────────────────────────────────

const PICKER_OPTIONS = {
  mediaTypes: ['images'],
  allowsEditing: false,
  quality: 0.85,
  base64: true,
} as const;

/**
 * Requests the appropriate permission and, if granted, launches the native
 * image picker or camera.  If permission is denied an Alert is shown with an
 * "Einstellungen öffnen" button.
 *
 * All external calls are injected via `deps` so they can be stubbed in tests.
 */
export async function requestAndLaunch(
  useCamera: boolean,
  deps: NativeDeps,
): Promise<void> {
  try {
    const permResult = useCamera
      ? await deps.requestCameraPermissions()
      : await deps.requestMediaLibraryPermissions();

    if (!permResult.granted) {
      deps.showAlert(
        'Berechtigung erforderlich',
        useCamera
          ? 'Kamerazugriff benötigt. Bitte erlauben Sie den Kamerazugriff in den Systemeinstellungen.'
          : 'Zugriff auf die Fotobibliothek benötigt. Bitte erlauben Sie den Zugriff in den Systemeinstellungen.',
        [
          { text: 'Abbrechen', style: 'cancel' },
          { text: 'Einstellungen öffnen' },
        ],
      );
      return;
    }

    const result = useCamera
      ? await deps.launchCamera(PICKER_OPTIONS)
      : await deps.launchImageLibrary(PICKER_OPTIONS);

    if (result.canceled || !result.assets?.[0]) return;

    const asset = result.assets[0];
    if (!asset.base64) {
      // Expo may return null (not just undefined) when base64 is unavailable
      deps.showAlert('Fehler', 'Bild konnte nicht gelesen werden.', [{ text: 'OK' }]);
      return;
    }

    await deps.processOcr(asset.base64, asset.uri, asset.mimeType ?? 'image/jpeg');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unbekannter Fehler';
    deps.showAlert(
      'Fehler',
      `Galerie konnte nicht geöffnet werden: ${message}`,
      [{ text: 'OK' }],
    );
  }
}
