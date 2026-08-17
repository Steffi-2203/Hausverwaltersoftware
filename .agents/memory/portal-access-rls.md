---
name: Portal-access RLS pattern
description: RLS design for tenant_portal_access/owner_portal_access (self-isolation settings, mixed sessions, bootstrap via rootDb)
---

# Portal-access RLS

Rule: `tenant_portal_access` / `owner_portal_access` carry RLS+FORCE with a two-layer policy:
`organization_id = app.current_org` AND (self setting NULL → org-wide, else `tenant_id`/`owner_id` must match `app.current_tenant`/`app.current_owner`).

**Why:** Admin sessions (only org set) legitimately see all portal accesses of their org; portal sessions must see ONLY their own row. Auth bootstrap (login, invite-token, portal middleware first read) runs on `rootDb` (postgres, BYPASSRLS), so RLS never blocks login.

**How to apply:**
- Portal middlewares set the self setting transaction-locally after resolving org via rootDb.
- Mixed session (admin + portal ids in one session): rlsMiddleware already built the org context, so the portal middleware must NOT early-return — it sets the self setting on the *existing* transaction client (`orgContext.getStore().client`) and 401s on org mismatch. Early-returning there silently drops self-isolation.
- `set_config(..., is_local=true)` outside a transaction is a silent no-op — all context middlewares wrap in BEGIN/COMMIT.
- NULL-org rows are invisible to everyone under this policy (middleware also 401s them) — backfill/NOT NULL is the follow-up.
