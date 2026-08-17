# ImmoflowMe — Österreichische Hausverwaltungssoftware

Webbasierte Hausverwaltung für den österreichischen Markt mit Fokus auf
Rechtskonformität: **MRG**, **WEG 2002**, **HeizKG**, DSGVO, BAO §132, GoBD.

## Funktionsumfang (Auszug)

- Doppelte Buchführung mit österreichischem Kontenrahmen (Saldenliste, Bilanz, GuV, UVA)
- HeizKG-konforme Heizkostenabrechnung (§§5–15, Ersatzverteilung, Restcent-Regel, Prüfprotokoll)
- Betriebskostenabrechnung mit MRG-Verteilschlüsseln und §21-konformen PDFs
- WEG-Verwaltung: Vorschreibungen, Rücklagen, Eigentümerversammlungen, Wirtschaftspläne
- SEPA-Export (Dateiweg), CAMT.053-Import, automatischer Zahlungsabgleich, Mahnwesen
- EBICS-Vorbereitung (Verbindungen, INI/HIA-Briefe) — **kein Live-Banktransport**, siehe „Zahlungsverkehr"
- VPI-Indexierung, Richtwert-/Kategoriemietzins, MieWeG-Indexierungsrechner
- Mieter- und Eigentümerportale, elektronische Signaturen (eIDAS), DMS
- BMD NTCS / DATEV-Export, FinanzOnline-Anbindung

## Tech-Stack

Express 5 + TypeScript · React 18 + Vite · PostgreSQL + Drizzle ORM ·
shadcn/ui + Tailwind · TanStack Query · Vitest + Playwright

## Setup

```sh
cp .env.example .env    # Werte eintragen (DATABASE_URL, SESSION_SECRET, …)
npm ci
npm run db:push         # Schema anwenden
npm run dev             # http://localhost:5000
```

## Qualitätssicherung

```sh
npm test                 # Unit-Tests (Abrechnungen, SEPA, Sicherheit, Isolation)
npm run verify:money     # Verifikation der Cent-genauen Geld-Arithmetik
npm run typecheck:strict # Strict-Mode für den finanzkritischen Kern
npm run lint
```

## Wichtige Konventionen

- **Geldbeträge**: Berechnungen laufen intern über Integer-Cents
  (`server/lib/money.ts`) mit kaufmännischer Rundung. Kein `Math.round(x*100)/100`,
  kein Float-Aufsummieren von Euro-Beträgen in neuen Code einbauen.
- **Mandantentrennung**: Postgres Row-Level-Security über `app.current_org`
  (`server/middleware/rlsMiddleware.ts`). Direktzugriffe am RLS-Client vorbei vermeiden.
- **Niemals** Datenbank-Dumps, Backups oder `.env` committen — die CI blockiert das.

## Sicherheit

Siehe [SECURITY.md](./SECURITY.md) für Meldewege und die Historie
sicherheitsrelevanter Bereinigungen.

## Schlüsselrotation (FIELD_ENCRYPTION_KEY)

IBAN/BIC-Felder sind mit AES-256-GCM verschlüsselt (Format `enc:v1:`). Wenn der
Schlüssel kompromittiert ist oder aus Compliance-Gründen gewechselt werden muss:

1. Neuen 32-Byte-Schlüssel erzeugen:
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
2. Rotation ausführen (Schlüssel nur als Umgebungsvariablen, nie als CLI-Argument):
   ```
   FIELD_ENCRYPTION_KEY_OLD=<alter Key> FIELD_ENCRYPTION_KEY_NEW=<neuer Key> pnpm run rotate-encryption-key
   ```
   Das Skript liest alle `enc:v1:`-Zeilen (bank_accounts, tenants, owners,
   organizations, contractors, ebics_connections, transactions.partner_iban,
   kautionen.treuhandkonto_iban) mit dem alten Schlüssel und speichert sie mit
   dem neuen. Klartext-Altbestand wird dabei mitverschlüsselt.
3. `FIELD_ENCRYPTION_KEY` auf den neuen Wert setzen (Development UND
   Production-Deployment-Secrets) und den Server neu starten.

Eigenschaften: idempotent (abgebrochene Läufe gefahrlos wiederholbar; bereits
mit dem neuen Schlüssel lesbare Zeilen werden übersprungen), kein Klartext in
Logs oder Fehlermeldungen, Zeilenfehler brechen den Lauf nicht ab (Exit-Code 1
+ Auflistung der betroffenen Zeilen-IDs am Ende).

**Wartungsfenster:** Die Rotation in einem Wartungsfenster ausführen (Server
stoppen, keine parallelen Writes). Als Sicherheitsnetz arbeitet das Skript mit
Compare-and-Swap-Updates und Verifikationsdurchgängen, die während der Rotation
mit dem alten Schlüssel geschriebene Zeilen nachziehen — das ersetzt das
Wartungsfenster aber nicht.

## Erforderliche Secrets (Production-Deployment)

| Secret | Zweck | Validierung |
| --- | --- | --- |
| `FIELD_ENCRYPTION_KEY` | AES-256-GCM-Verschlüsselung von IBAN/BIC-Feldern | genau 32 Byte, Base64 — Server startet in Production NICHT ohne validen Key |
| `SESSION_SECRET` | Signierung der Sessions | mind. 32 Zeichen |
| `DATABASE_URL` | PostgreSQL-Verbindung | wird von Replit gesetzt |

Vor jedem Rollout prüfen: `pnpm run check-deploy-env` (Exit 1 bei fehlenden oder
ungültigen Secrets, ohne Werte auszugeben). Zusätzlich validiert der Server beim
Boot: in `NODE_ENV=production` ist ein fehlender oder ungültiger
`FIELD_ENCRYPTION_KEY` fatal (Prozess beendet sich statt im Klartext-Modus zu
laufen); in Development wird nur gewarnt.
