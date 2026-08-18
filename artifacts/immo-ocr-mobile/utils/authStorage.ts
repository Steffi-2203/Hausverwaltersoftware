/**
 * authStorage – pure storage operations for auth credentials.
 *
 * Extracted from AuthContext so they can be unit-tested without a React
 * environment or expo-secure-store dependency. All functions accept an
 * injectable StorageAdapter; AuthContext passes the real SecureStore.
 */

export const TOKEN_KEY = 'immo_ocr_token';
export const USER_KEY  = 'immo_ocr_user';

export interface StorageAdapter {
  getItemAsync:    (key: string) => Promise<string | null>;
  setItemAsync:    (key: string, value: string) => Promise<void>;
  deleteItemAsync: (key: string) => Promise<void>;
}

export interface StoredAuthUser {
  id:             string;
  email:          string;
  fullName:       string;
  organizationId: string;
}

/**
 * Persist token + user after a successful login.
 * Both writes are issued in parallel for speed.
 */
export async function saveAuthCredentials(
  store: StorageAdapter,
  token: string,
  user:  StoredAuthUser,
): Promise<void> {
  await Promise.all([
    store.setItemAsync(TOKEN_KEY, token),
    store.setItemAsync(USER_KEY,  JSON.stringify(user)),
  ]);
}

/**
 * Delete all stored credentials (logout).
 * Both deletes are issued in parallel.
 * Safe to call when keys don't exist (no-op).
 */
export async function clearAuthCredentials(store: StorageAdapter): Promise<void> {
  await Promise.all([
    store.deleteItemAsync(TOKEN_KEY),
    store.deleteItemAsync(USER_KEY),
  ]);
}

/**
 * Load credentials from storage.
 * Returns null if either key is absent or the user JSON is malformed.
 */
export async function loadAuthCredentials(
  store: StorageAdapter,
): Promise<{ token: string; user: StoredAuthUser } | null> {
  const [storedToken, storedUser] = await Promise.all([
    store.getItemAsync(TOKEN_KEY),
    store.getItemAsync(USER_KEY),
  ]);
  if (!storedToken || !storedUser) return null;
  try {
    return { token: storedToken, user: JSON.parse(storedUser) as StoredAuthUser };
  } catch {
    // Corrupted JSON — treat as logged-out.
    return null;
  }
}
