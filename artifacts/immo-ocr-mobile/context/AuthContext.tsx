import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import { correctionQueue } from '@/utils/pendingCorrections';
import { fetchWithTimeout } from '@/utils/fetchWithTimeout';
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
}

// ── Context ──────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextType | null>(null);

const TOKEN_KEY = 'immo_ocr_token';
const USER_KEY  = 'immo_ocr_user';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token,       setToken]       = useState<string | null>(null);
  const [user,        setUser]        = useState<AuthUser | null>(null);
  const [isLoading,   setIsLoading]   = useState(true);
  const [currentScan, setCurrentScan] = useState<ScanResult | null>(null);

  const apiDomain = process.env.EXPO_PUBLIC_DOMAIN ?? '';

  // Keep a stable ref to the latest token so flushPendingCorrections always
  // uses the current value even if called before a re-render.
  const tokenRef = useRef<string | null>(null);
  tokenRef.current = token;

  useEffect(() => {
    (async () => {
      try {
        const [storedToken, storedUser] = await Promise.all([
          SecureStore.getItemAsync(TOKEN_KEY),
          SecureStore.getItemAsync(USER_KEY),
        ]);
        if (storedToken && storedUser) {
          setToken(storedToken);
          setUser(JSON.parse(storedUser) as AuthUser);
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

  async function apiRequest(
    path: string,
    options: RequestInit = {},
    timeoutMs = 30_000,
  ): Promise<Response> {
    const url = `https://${apiDomain}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> ?? {}),
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return fetchWithTimeout(url, { ...options, headers }, timeoutMs);
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
    setToken(data.token);
    setUser(newUser);
  }

  async function flushPendingCorrections(): Promise<number> {
    const currentToken = tokenRef.current;
    if (!currentToken) return 0;

    // Only flush items that belong to the currently authenticated user to
    // prevent cross-account data leakage on shared devices.
    const currentUserId = user?.id;
    if (!currentUserId) return 0;

    const queue = await correctionQueue.getForUser(currentUserId);
    if (queue.length === 0) return 0;

    let flushed = 0;
    for (const item of queue) {
      try {
        const url = `https://${apiDomain}/api/ocr/corrections`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15_000);
        let res: Response;
        try {
          res = await fetch(url, {
            method:  'POST',
            headers: {
              'Content-Type':  'application/json',
              'Authorization': `Bearer ${currentToken}`,
            },
            body:   JSON.stringify(item.payload),
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeout);
        }
        if (res.ok) {
          await correctionQueue.remove(item.id);
          flushed++;
        }
        // 401 = token expired; stop early so we don't burn through the queue.
        if (res.status === 401) break;
      } catch {
        // Network error or timeout — stop and retry on next startup.
        break;
      }
    }
    return flushed;
  }

  async function logout(): Promise<void> {
    await Promise.all([
      SecureStore.deleteItemAsync(TOKEN_KEY),
      SecureStore.deleteItemAsync(USER_KEY),
    ]);
    setToken(null);
    setUser(null);
    setCurrentScan(null);
  }

  return (
    <AuthContext.Provider
      value={{ token, user, isLoading, login, logout, currentScan, setCurrentScan, apiRequest, flushPendingCorrections }}
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
