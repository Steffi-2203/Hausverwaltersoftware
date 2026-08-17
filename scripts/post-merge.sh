#!/bin/bash
set -e

pnpm install --frozen-lockfile

# HINWEIS: Kein `pnpm --filter db push` hier!
# drizzle-kit push aus lib/db kennt nur das api-server-Schema und würde auf der
# gemeinsamen Datenbank alle App-Tabellen (immo-flow-me) DROPPEN — Datenverlust.
# Schema-Änderungen der Haupt-App laufen als SQL-Migrationen automatisch beim
# Server-Boot (server/index.ts → [migrations]); die Workflow-Reconciliation
# startet den Server nach dem Merge ohnehin neu.

# GitHub-Backup nach jedem Merge aktuell halten (inkrementell). Läuft entkoppelt
# im Hintergrund (setsid + nohup), damit weder ein Backup-Fehler noch das
# 120s-Timeout des Post-Merge-Hooks den Merge blockieren oder das Backup
# abbrechen kann. Log unter /tmp/github-backup.log.
# Nebenläufigkeit: blockierendes flock im Wrapper — jeder Aufruf wartet auf
# den Lock und führt dann seinen eigenen (inkrementellen) Lauf aus. Der letzte
# Aufruf erfasst damit garantiert den neuesten Workspace-Stand.
setsid nohup bash scripts/backup-to-github-locked.sh >> /tmp/github-backup.log 2>&1 < /dev/null &
echo "GitHub-Backup im Hintergrund gestartet (Log: /tmp/github-backup.log)"
