---
name: rootDb system-table isolation
description: Security rule for system tables that rootDb accesses before an organization context exists.
---

System tables used only through `rootDb` must explicitly deny the normal
`immo_app` role: enable and force RLS with no app policy and revoke the role's
table privileges. The default database-role migration grants DML on every
public table, including newly migrated system tables.

**Why:** A table without an organization id is skipped by the organization-RLS
setup. Without an explicit deny rule, `immo_app` can access it despite the
intended privileged-only boundary.

**How to apply:** Whenever a migration creates a non-tenant system table for a
pre-org-context or rootDb-only path, include the explicit RLS/privilege
hardening and an appPool test that confirms reads and writes are rejected.