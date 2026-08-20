import {
  type BruteForceStore,
  type BruteForceStoreOptions,
  createDefaultBruteForceStore,
} from "./bruteForceStore";

export const AUTH_MAX_FAILED_ATTEMPTS = 5;
export const AUTH_BLOCK_DURATION_MS = 15 * 60 * 1000;

export interface AuthBruteForceProtection {
  isLoginBlocked(email: string): Promise<boolean>;
  recordLoginFailure(email: string): Promise<void>;
  completeLoginSuccess(email: string): Promise<boolean>;
  remainingLoginAttempts(email: string): Promise<number>;
  isTwoFactorBlocked(userId: string): Promise<boolean>;
  recordTwoFactorFailure(userId: string): Promise<void>;
  completeTwoFactorSuccess(userId: string): Promise<boolean>;
}

export interface AuthBruteForceOptions extends BruteForceStoreOptions {
  store?: BruteForceStore;
}

export function loginBruteForceKey(email: string): string {
  return `auth:login:v1:${email.trim().toLowerCase()}`;
}

export function twoFactorBruteForceKey(userId: string): string {
  return `auth:2fa:v1:${userId}`;
}

/**
 * Login- und 2FA-Sperren verwenden den persistenten PostgreSQL-Store. Die
 * getrennten Namensräume verhindern, dass Fehlversuche aus verschiedenen
 * Authentifizierungsschritten einander beeinflussen. In der Datenbank liegen
 * die Schlüssel ausschließlich gehasht vor.
 */
export function createAuthBruteForceProtection(
  options: AuthBruteForceOptions = {},
): AuthBruteForceProtection {
  const maxFailedAttempts = options.maxFailedAttempts ?? AUTH_MAX_FAILED_ATTEMPTS;
  const store = options.store ?? createDefaultBruteForceStore({
    maxFailedAttempts,
    blockDurationMs: options.blockDurationMs ?? AUTH_BLOCK_DURATION_MS,
    cleanupIntervalMs: options.cleanupIntervalMs,
  });

  return {
    isLoginBlocked: (email) => store.isBlocked(loginBruteForceKey(email)),
    recordLoginFailure: (email) => store.recordFailure(loginBruteForceKey(email)),
    completeLoginSuccess: (email) => store.clearFailuresIfNotBlocked(loginBruteForceKey(email)),
    async remainingLoginAttempts(email) {
      const failedAttempts = await store.getFailureCount(loginBruteForceKey(email));
      return Math.max(0, maxFailedAttempts - failedAttempts);
    },
    isTwoFactorBlocked: (userId) => store.isBlocked(twoFactorBruteForceKey(userId)),
    recordTwoFactorFailure: (userId) => store.recordFailure(twoFactorBruteForceKey(userId)),
    completeTwoFactorSuccess: (userId) => store.clearFailuresIfNotBlocked(twoFactorBruteForceKey(userId)),
  };
}

export const authBruteForce = createAuthBruteForceProtection();