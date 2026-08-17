---
name: Post-merge script must not run drizzle push
description: Why `pnpm --filter db push` in the post-merge script risks dropping app tables on the shared database
---

The post-merge setup script must never run `drizzle-kit push` from `lib/db` (@workspace/db).

**Why:** lib/db's drizzle schema only covers the api-server tables. Pushing it against the shared Postgres database makes drizzle-kit propose DROPs of all immo-flow-me app tables (monthly_invoices, owners, ...) — with `--force` this is silent data loss; without it, it hangs on a TTY prompt (stdin closed → failure).

**How to apply:** Schema changes for the main app run as SQL migrations automatically at server boot; workflow reconciliation restarts the server after every merge, so the post-merge script only needs `pnpm install --frozen-lockfile`. If api-server ever needs schema sync, use targeted migrations, never a blanket push on the shared DB.
