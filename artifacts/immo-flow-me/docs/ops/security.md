# Security Runbook - ImmoflowMe

## Changelog

| Datum | Actor | Änderung | Commit |
|-------|-------|----------|--------|
| 2026-02-08 | Replit Agent | Security Hardening v2: zxcvbn ≥ 3, HIBP Leak-Check, Password History (5), Account Lockout (5/15min) | `1939cac` |
| 2026-02-08 | Replit Agent | Security Hardening v1: Rate Limiting, Session Hardening, Audit Logging, Password Min 10→12 | `3f34363` |

---

## Password Policy

| Parameter | Wert | Seit |
|-----------|------|------|
| Mindestlänge | 12 Zeichen | 2026-02-08 |
| Komplexität | zxcvbn Score ≥ 3 (von 4) | 2026-02-08 |
| Leaked Password Check | Have I Been Pwned k-Anonymity API (SHA-1 Prefix) | 2026-02-08 |
| Password History | Letzte 5 Passwörter nicht wiederverwendbar | 2026-02-08 |
| Hashing | bcrypt, 12 Rounds | Initial |
| Angewendet auf | Register, Reset-Password | 2026-02-08 |

### Implementierung
- **Datei**: `server/auth.ts` → `validatePasswordStrength()`
- **Tabelle**: `password_history` (user_id, password_hash, created_at)
- **HIBP API**: `https://api.pwnedpasswords.com/range/{prefix}` - nur 5 Zeichen des SHA-1 Hash werden gesendet (datenschutzkonform)
- **Fallback**: Bei HIBP-API-Ausfall wird der Check übersprungen (fail-open mit console.warn)

---

## Account Lockout

| Parameter | Wert | Seit |
|-----------|------|------|
| Max. Fehlversuche | 5 innerhalb 15 Minuten | 2026-02-08 |
| Sperrdauer | 15 Minuten (automatisch) | 2026-02-08 |
| Warnung bei | ≤ 2 verbleibenden Versuchen | 2026-02-08 |
| Reset bei | Erfolgreichem Login | 2026-02-08 |

### Implementierung
- **Datei**: `server/auth.ts` → `checkAccountLockout()`, `recordLoginAttempt()`
- **Tabelle**: `login_attempts` (email, ip_address, success, attempted_at)
- **Index**: `idx_login_attempts_email` auf (email, attempted_at)
- **HTTP Status**: 429 bei gesperrtem Account mit `lockedUntilMinutes`
- **Scope**: Nur Login-Route betroffen (Register/Reset nicht gesperrt)

---

## API Rate Limiting

| Route | Limit | Fenster | Seit |
|-------|-------|---------|------|
| Allgemeine API | 100 Requests | 15 Minuten / IP | 2026-02-08 |
| Auth-Routen (`/api/auth/*`) | 20 Requests | 1 Minute / IP | 2026-02-08 |
| Stripe Webhooks | 5 Requests | 1 Minute / IP | 2026-02-08 |

### Implementierung
- **Datei**: `server/index.ts`
- **Library**: `express-rate-limit`

---

## Session Security

| Parameter | Wert | Seit |
|-----------|------|------|
| Cookie Name (Prod) | `__Secure-immo_sid` | 2026-02-08 |
| Cookie Name (Dev) | `immo_sid` | 2026-02-08 |
| httpOnly | `true` | 2026-02-08 |
| secure (Prod) | `true` | 2026-02-08 |
| sameSite (Prod) | `none` | 2026-02-08 |
| sameSite (Dev) | `lax` | 2026-02-08 |
| maxAge | 24 Stunden | 2026-02-08 |
| Storage | PostgreSQL (`user_sessions` Tabelle) | Initial |

### Cookie Clearing
- Logout löscht Cookie mit identischen Attributen (path, httpOnly, secure, sameSite)
- Verhindert Cookie-Persistenz durch Attribut-Mismatch

---

## Auth Event Audit Logging

| Event | Erfasste Daten | Seit |
|-------|---------------|------|
| `login` | email, userId, IP, User-Agent | 2026-02-08 |
| `login_failed` | email, userId, IP, Grund (unknown_email, wrong_password, account_locked) | 2026-02-08 |
| `register` | email, userId, IP | 2026-02-08 |
| `register_failed` | email, IP, Grund (weak_password) | 2026-02-08 |
| `logout` | email, userId, IP | 2026-02-08 |

### Implementierung
- **Funktion**: `logAuthEvent()` → delegiert an `createAuditLog()` aus `server/lib/auditLog.ts`
- **Tabelle**: `audit_logs`
- **Fehlerbehandlung**: try/catch in `createAuditLog`, blockiert Auth-Flow nicht

---

## HTTP Security Headers

- **Library**: Helmet.js
- **Headers**: CSP, HSTS, X-Frame-Options, X-Content-Type-Options, etc.
- **CORS**: Whitelist-basierte Origin-Validierung

---

## Abhängigkeiten

| Package | Version | Zweck |
|---------|---------|-------|
| `bcrypt` | ^5.x | Passwort-Hashing (12 Rounds) |
| `zxcvbn` | ^4.x | Passwort-Stärke-Bewertung |
| `express-rate-limit` | ^7.x | API Rate Limiting |
| `helmet` | ^8.x | HTTP Security Headers |
| `connect-pg-simple` | ^10.x | Session Storage (PostgreSQL) |

---

## Datenbank-Tabellen (Security)

```sql
-- Password History
CREATE TABLE password_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES profiles(id),
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_password_history_user_id ON password_history(user_id);

-- Login Attempts
CREATE TABLE login_attempts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL,
  ip_address TEXT,
  success BOOLEAN NOT NULL DEFAULT false,
  attempted_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_login_attempts_email ON login_attempts(email, attempted_at);
```

---

## Notfall-Prozeduren

### Account manuell entsperren
```sql
DELETE FROM login_attempts WHERE email = 'user@example.com' AND success = false;
```

### Password History zurücksetzen
```sql
DELETE FROM password_history WHERE user_id = '<user-uuid>';
```

### Audit Log prüfen (letzte fehlgeschlagene Logins)
```sql
SELECT * FROM audit_logs
WHERE table_name = 'auth' AND action = 'login_failed'
ORDER BY created_at DESC LIMIT 20;
```
