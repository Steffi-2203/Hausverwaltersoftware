# ImmoflowMe Release Notes

## Version 1.0.0 - Release Candidate (2026-02-12)

### Status

| Check | Ergebnis |
|-------|----------|
| Unit Tests | 225/225 bestanden (19 Dateien) |
| Smoke Tests | 17/17 bestanden |
| Health Check | OK (DB connected, Latenz <1ms) |
| Readiness Probe | OK |
| Startup Probe | OK |
| Node.js | v20.20.0 |

### Neue Features in diesem Release

**Mieter-Self-Service Portal**
- Dediziertes Mieter-Login (unabhaengig vom Admin-Login)
- E-Mail + Passwort-Authentifizierung mit bcrypt
- Einladungssystem mit 7-Tage Token-Links
- Eigenstaendiges Portal mit Dashboard, Rechnungen, Zahlungen, Dokumenten
- Admin-Einladungsverwaltung mit Ein-Klick-Versand

**Schadensmeldungen**
- Automatische Nummernvergabe (SM-YYYY-XXXX)
- Kategorie- und Dringlichkeitsklassifizierung
- Status-Workflow (gemeldet/in_bearbeitung/behoben/abgelehnt)
- Kostenerfassung und Dokumentation

**ESG/Energiemonitoring**
- Energieausweise (HWB, fGEE, PEB, CO2)
- Verbrauchstracking pro Liegenschaft/Einheit
- CO2-Bilanz mit Jahresvergleich
- Oesterreichische Energieklassen (A++ bis G)

**DSGVO-Compliance**
- Server-seitige Einwilligungsverwaltung (Art. 7)
- Art. 30 Verarbeitungsverzeichnis
- Automatisierte Aufbewahrungsfristen (BAO, ABGB, HeizKG)
- Datenexport (Art. 15/20) und Anonymisierung (Art. 17)
- Cookie-Banner mit granularer Steuerung

**Support-Ticketing**
- Auto-generierte Ticketnummern
- Kategorie/Prioritaets-Verwaltung
- Kommentar-Threads und Status-Tracking

**Guided Workflows**
- BK-Abrechnung (6 Schritte)
- Mahnlauf (5 Schritte)
- VPI-Mietanpassung (5 Schritte)
- Mietereinzug (6 Schritte)

**PWA-Unterstuetzung**
- Offline-Faehigkeit via Service Worker
- Mobile Installation
- Push-Notification-Infrastruktur

### Sicherheit
- bcrypt-Passwortverschluesselung (10 Rounds)
- CSRF-Schutz (Double-Submit Cookie)
- Organisations-basierte Multi-Tenant-Isolation
- Rate Limiting
- HTTP Security Headers (Helmet.js)
- Nonce-basierte CSP
- Session-Sicherheit (HTTP-only, Secure Cookies, PostgreSQL)
- GoBD Audit Hash Chain

### Infrastruktur
- Health-Endpunkt: `/api/health` (DB, Memory, CPU, Uptime)
- Readiness-Probe: `/api/ready`
- Startup-Probe: `/api/startup`
- Smoke-Test-Script: `scripts/smoke-test.sh`
- Deployment: Autoscale-Konfiguration (Vite Build + Express Production)

### Bekannte Einschraenkungen
- Sentry-Monitoring muss extern konfiguriert werden
- GitHub Branch-Protection muss manuell gesetzt werden
- Release-Tags muessen via GitHub CLI erstellt werden

---

## Externe Aufgaben (vor Produktions-Release)

### 1. GitHub Branch-Protection
```
Repository Settings > Branches > Branch protection rules:
- Branch: main
- Require pull request reviews: 1 Reviewer
- Require status checks: Unit Tests, Smoke Tests
- Require linear history (optional)
- Do not allow bypassing the above settings
```

### 2. Bot-Commit-Policy
- Replit Agent Commits: Automatisch via Agent, kein separater Bot noetig
- CI/CD Bot: Falls GitHub Actions genutzt werden, separate Machine-User anlegen
- Signed Commits: Empfohlen fuer Produktions-Branches

### 3. Sentry-Monitoring
```bash
# Installation (sobald Sentry-DSN vorhanden):
npm install @sentry/node @sentry/profiling-node

# In server/index.ts einbinden:
# Sentry.init({ dsn: process.env.SENTRY_DSN, tracesSampleRate: 0.1 })

# Alerts konfigurieren:
# - Error Rate > 5/min -> Slack/Email
# - Response Time p95 > 2s -> Warning
# - DB Latency > 100ms -> Warning
# - Unhandled Rejection -> Critical
```

### 4. Release-Tag (via GitHub CLI)
```bash
git tag -a v1.0.0-rc1 -m "Release Candidate 1 - Full Austrian Property Management"
git push origin v1.0.0-rc1
```

### 5. Staging-Validierung
- Replit Deployment auf "Staging" Domain veroeffentlichen
- Smoke-Tests gegen Staging-URL ausfuehren:
  `bash scripts/smoke-test.sh https://staging.immoflowme.at`
- Manuelle Pruefung: Login, Liegenschaft anlegen, Mieter erstellen, Rechnung generieren

### 6. Post-Release-Checkliste
- [ ] Smoke-Tests gegen Produktion bestanden
- [ ] Health-Endpunkt erreichbar und status=ok
- [ ] Admin-Login funktioniert
- [ ] Mieter-Portal-Login funktioniert
- [ ] Rechnungsgenerierung getestet
- [ ] SEPA-Export funktioniert
- [ ] E-Mail-Versand (Resend) funktioniert
- [ ] Stripe-Integration aktiv
- [ ] DSGVO-Dashboard erreichbar
- [ ] PWA installierbar
