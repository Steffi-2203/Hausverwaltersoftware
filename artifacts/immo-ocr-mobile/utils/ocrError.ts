/**
 * Pure helper that maps an OCR error to a user-visible alert.
 *
 * Extracted from the scan.tsx catch-block so it can be tested without a React
 * Native runtime. scan.tsx calls this and passes Alert.alert as showAlert.
 */

export interface AlertButton {
  text: string;
}

export function handleOcrError(
  err: unknown,
  showAlert: (title: string, message: string, buttons: AlertButton[]) => void,
): void {
  const message =
    (err as any)?.message ??
    'Die Rechnung konnte nicht analysiert werden. Bitte erneut versuchen.';
  showAlert('OCR fehlgeschlagen', message, [{ text: 'OK' }]);
}
