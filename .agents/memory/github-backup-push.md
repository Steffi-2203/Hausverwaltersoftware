---
name: GitHub-Backup per API-Push
description: Wie der Workspace-Code ohne funktionierendes `git push` zu GitHub gesichert wird
---

# GitHub-Backup per API-Push

**Regel:** `git push` zu GitHub schlägt in diesem Workspace fehl — der Replit-Askpass liefert für github.com keinen Token (Username `token`, leeres Passwort), und der Connector-Token ist nicht exportierbar (octokit `client.auth()` liefert nur `{type}`). Backup läuft stattdessen über die Git-Data-API des GitHub-Connectors.

**Why:** Die GitHub-Verbindung ist ein Replit-Connector (Proxy-Auth serverseitig); es gibt keinen lokalen Git-Credential-Pfad.

**Durable Constraints beim API-Push:** Blob-API verweigert leere Repos (erst initialisieren); bei frisch angelegten Repos lagen die Git-Read-Endpunkte (refs/branches/trees) minutenlang hinter den Write-Endpunkten; Repl-Proxy limitiert auf ~10 RPS; ein einzelner createTree-Call mit ~900 Einträgen timet out (chunken + base_tree); Blob-SHAs sind content-addressiert (kein Re-Upload nach Fehlschlag nötig).

Ziel-Repo: `Steffi-2203/Hausverwaltersoftware` (main). Achtung: Repo ist **public** — Secret-Dateien explizit ausschließen. Connector-Token hat kein delete_repo (Scratch-Repos können nicht per API gelöscht werden).
