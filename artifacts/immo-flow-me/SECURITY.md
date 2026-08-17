# Sicherheit

## Sicherheitslücken melden

Bitte Schwachstellen nicht als öffentliches GitHub-Issue melden, sondern
vertraulich an den Repository-Inhaber.

## ⚠️ Erforderliche Maßnahmen vor dem nächsten Push (Stand: Juli 2026)

Im Repository lagen bis zur Bereinigung Datenbank-Dumps mit personenbezogenen
Daten (private E-Mail-Adressen) und bcrypt-Passwort-Hashes:

- `backup_before_billing_2026-02-01.sql`
- `backup_before_payment_patch.sql`
- `backup_before_payment_patch_2026-02-01.sql`
- `pre_reconcile_2026_09.dump`

Die Dateien wurden aus dem Arbeitsstand entfernt und `.gitignore` blockiert
sie künftig. **Das genügt nicht**, wenn sie jemals committet und zu GitHub
gepusht wurden — dann stecken sie weiterhin in der Git-History und sind über
alte Commits abrufbar.

### 1. Git-History bereinigen (einmalig, lokal)

```sh
# git-filter-repo installieren: https://github.com/newren/git-filter-repo
pip install git-filter-repo

git clone --mirror git@github.com:DEIN_USER/immoflowme.git immoflowme-mirror
cd immoflowme-mirror

git filter-repo \
  --invert-paths \
  --path backup_before_billing_2026-02-01.sql \
  --path backup_before_payment_patch.sql \
  --path backup_before_payment_patch_2026-02-01.sql \
  --path pre_reconcile_2026_09.dump \
  --path dryrun.json \
  --path attached_assets \
  --path playwright-report \
  --path test-results \
  --path data

git push --force --mirror
```

Danach müssen alle Mitwirkenden **frisch klonen** (kein pull über die
umgeschriebene History). GitHub-Caches alter Commits verschwinden nach dem
Force-Push nicht sofort — bei Bedarf den GitHub-Support um Cache-Invalidierung
bitten ("remove cached views / sensitive data removal").

### 2. Zugangsdaten als kompromittiert behandeln

- Passwörter aller Konten, deren Hashes in den Dumps standen, zurücksetzen
  (Hashes waren bcrypt cost 10/12 — kein Klartext, aber offline angreifbar).
- Betroffene Nutzer:innen informieren (DSGVO Art. 33/34 prüfen: je nach
  Sichtbarkeit des Repos kann eine meldepflichtige Verletzung vorliegen).
- Alle in der Umgebung verwendeten Secrets rotieren: `SESSION_SECRET`,
  Stripe-Keys, `RESEND_API_KEY`, OpenAI-Keys, `INTERNAL_CRON_SECRET`,
  Datenbank-Passwort.

### 3. GitHub-Repo-Einstellungen aktivieren

- **Settings → Code security**: Secret scanning + Push protection aktivieren
- Dependabot Alerts + Security Updates aktivieren
- Branch protection für `main` (CI muss grün sein, keine Force-Pushes)

Die CI (`.github/workflows/ci.yml`) enthält zusätzlich einen
Gitleaks-Secret-Scan und einen Wächter, der Dumps im Repo blockiert.

## Sicherheitsarchitektur (Überblick)

- Multi-Tenancy: Postgres Row-Level-Security über `app.current_org`,
  parametrisiert gesetzt in `server/middleware/rlsMiddleware.ts`
- AuthN/AuthZ: Sessions + bcrypt, TOTP-2FA, rollenbasierte Autorisierung,
  Ownership-Checks (`server/lib/ownershipCheck.ts`)
- Härtung: Helmet mit nonce-basierter CSP, CSRF-Schutz, Rate-Limiting,
  Input-Sanitizing, Idempotency-Keys, PII-Redaction in Logs
- Audit: GoBD-Hash-Kette (`server/services/auditHashService.ts`),
  BAO-§132-Aufbewahrung (`server/services/retentionService.ts`)
