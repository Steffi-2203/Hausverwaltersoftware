import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { correctionQueue } from '@/utils/pendingCorrections';
import { flushCorrections } from '@/utils/flushCorrections';
import { createRaceSafeLoader } from '@/utils/raceSafeCountLoader';
import { apiRequest as _apiRequest } from '@/utils/apiRequest';
import { loginRequest } from '@/utils/loginRequest';

// ── Types ────────────────────────────────────────────────────────────────────

export interface OcrValidierung {
  confidence_score: number;
  warnungen?: string[];
  fehler?: string[];
  unsichere_felder?: string[];
}

export interface OcrData {
  lieferant?: string;
  betrag?: string | number;
  netto_betrag?: string | number;
  datum?: string;
  rechnungsnummer?: string;
  kategorie?: string;
  expense_type?: string;
  beschreibung?: string;
  iban?: string;
  validierung: OcrValidierung;
}

export interface ScanResult {
  data: OcrData;
  needs_review: boolean;
  imageUri: string;
  fileName: string;
}

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  organizationId: string;
}

interface AuthContextType {
  token: string | null;
  user: AuthUser | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  currentScan: ScanResult | null;
  setCurrentScan: (scan: ScanResult | null) => void;
  apiRequest: (path: string, options?: RequestInit, timeoutMs?: number) => Promise<Response>;
  /** Retry all locally-queued OCR corrections. Returns the number flushed. */
  flushPendingCorrections: () => Promise<number>;
  /** Number of corrections waiting to be transmitted (0 when none pending). */
  pendingCount: number;
  /**
   * Re-read the queue and update pendingCount.
   * Call after any operation that may add items to the queue (e.g. a failed save).
   */
  refreshPendingCount: () => void;
}

// ── Context ──────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextType | null>(null);

const TOKEN_KEY = 'immo_ocr_token';
const USER_KEY  = 'immo_ocr_user';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token,        setToken]        = useState<string | null>(null);
  const [user,         setUser]         = useState<AuthUser | null>(null);
  const [isLoading,    setIsLoading]    = useState(true);
  const [currentScan,  setCurrentScan]  = useState<ScanResult | null>(null);
  const [pendingCount, setPendingCount] = useState<number>(0);

  const apiDomain = process.env.EXPO_PUBLIC_DOMAIN ?? '';

  // Keep stable refs so flushPendingCorrections always reads the latest
  // values even when called from a closure that captured stale state
  // (e.g. the AppState listener registered with [] dependencies).
  const tokenRef   = useRef<string | null>(null);
  const userRef    = useRef<AuthUser | null>(null);
  const flushingRef = useRef<boolean>(false); // in-flight guard
  tokenRef.current  = token;
  userRef.current   = user;

  // Monotonic-generation count loader — created once for the lifetime of the
  // provider. load() increments the internal generation so only the latest
  // outstanding read can ever apply. invalidate() bumps the generation on
  // logout/login so pre-transition reads (including same-account re-logins)
  // are always discarded.
  const countLoaderRef = useRef(
    createRaceSafeLoader(
      uid => correctionQueue.countForUser(uid),
      ()  => userRef.current?.id,
      setPendingCount,
    )
  );

  /**
   * Public: re-read the queue and update pendingCount.
   * Call after any operation that may have added items to the queue
   * (e.g. a failed save in review.tsx) so the scan-screen badge reflects
   * the current state immediately, without waiting for the next flush.
   */
  function refreshPendingCount() {
    const uid = userRef.current?.id;
    if (uid) countLoaderRef.current.load(uid);
  }

  useEffect(() => {
    (async () => {
      try {
        const [storedToken, storedUser] = await Promise.all([
          SecureStore.getItemAsync(TOKEN_KEY),
          SecureStore.getItemAsync(USER_KEY),
        ]);
        if (storedToken && storedUser) {
          const parsedUser = JSON.parse(storedUser) as AuthUser;
          setToken(storedToken);
          setUser(parsedUser);
          // Load pending count immediately so the badge appears before flush completes.
          countLoaderRef.current.load(parsedUser.id);
        }
      } catch {
        // ignore — treat as logged out
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  // Auto-flush queued corrections when a valid session is available.
  useEffect(() => {
    if (!token) return;
    flushPendingCorrections().catch(() => {/* silent — will retry on next startup */});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Also flush when the app returns to the foreground — catches the case
  // where a 503 kept an item queued and the DB has since recovered.
  // flushPendingCorrections reads tokenRef.current, so no closure risk.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') {
        flushPendingCorrections().catch(() => {/* silent — retry on next foreground */});
      }
    });
    return () => sub.remove();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function apiRequest(
    path: string,
    options: RequestInit = {},
    timeoutMs = 30_000,
  ): Promise<Response> {
    return _apiRequest(apiDomain, token, path, options, timeoutMs);
  }

  async function login(email: string, password: string): Promise<void> {
    const url  = `https://${apiDomain}/api/auth/login`;
    const data = await loginRequest(url, email, password);
    const newUser: AuthUser = {
      id:             data.id,
      email:          data.email,
      fullName:       data.fullName,
      organizationId: data.organizationId,
    };
    await Promise.all([
      SecureStore.setItemAsync(TOKEN_KEY, data.token),
      SecureStore.setItemAsync(USER_KEY,  JSON.stringify(newUser)),
    ]);
    // Discard any in-flight reads from a prior session before starting the
    // new one — protects against same-account re-login stale reads.
    countLoaderRef.current.invalidate();
    setToken(data.token);
    setUser(newUser);
    // Load queue count for the newly logged-in user so the badge reflects
    // any offline-queued corrections that accumulated while logged out.
    countLoaderRef.current.load(newUser.id);
  }

  async function flushPendingCorrections(): Promise<number> {
    // In-flight guard: prevent overlapping flushes from token-change and
    // foreground events racing each other and submitting the same item twice.
    if (flushingRef.current) return 0;

    // Read via refs so this function is safe to call from closures that
    // captured stale state (e.g. the AppState listener with [] deps).
    const currentToken  = tokenRef.current;
    const currentUserId = userRef.current?.id;
    if (!currentToken || !currentUserId) return 0;

    flushingRef.current = true;
    try {
      const n = await flushCorrections({
        token:     currentToken,
        userId:    currentUserId,
        apiDomain,
        queue:     correctionQueue,
        fetchFn:   fetch,
      });
      // Refresh badge after each flush attempt so it reflects the current queue.
      countLoaderRef.current.load(currentUserId);
      return n;
    } finally {
      flushingRef.current = false;
    }
  }

  async function logout(): Promise<void> {
    await Promise.all([
      SecureStore.deleteItemAsync(TOKEN_KEY),
      SecureStore.deleteItemAsync(USER_KEY),
    ]);
    // Discard any in-flight count reads before clearing state.
    countLoaderRef.current.invalidate();
    setToken(null);
    setUser(null);
    setCurrentScan(null);
    setPendingCount(0);
  }

  return (
    <AuthContext.Provider
      value={{ token, user, isLoading, login, logout, currentScan, setCurrentScan, apiRequest, flushPendingCorrections, pendingCount, refreshPendingCount }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
