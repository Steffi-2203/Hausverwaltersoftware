---
name: Artifact API route ownership
description: Preventing the standalone health artifact from shadowing IMMO FLOW ME API routes.
---

IMMO FLOW ME is the owner of the global `/api` namespace. The standalone API artifact is only a healthcheck service and must use a distinct prefix such as `/api-server`.

**Why:** Path-based artifact routing gives the more-specific `/api` service priority. When the standalone service claimed that path, it silently received the web app's authentication and business API calls even though it only exposes a health endpoint.

**How to apply:** Before assigning or changing an artifact service path, check which artifact owns the corresponding browser-facing routes. Do not mount diagnostics-only services under a product's API namespace; keep their Express mount, artifact path, and healthcheck path aligned.