#!/bin/bash
# Serialized wrapper around backup-to-github.mjs for concurrent invocations
# (e.g. overlapping post-merge hooks).
#
# Uses a BLOCKING flock: every invocation waits for the lock, then runs its
# own backup pass. Runs are strictly serialized and each caller's pass starts
# after its own invocation, so the last caller always captures the newest
# workspace state — there is no marker to strand and no final-check race.
# A queued pass after an up-to-date push is a cheap no-op ("up to date").
cd "$(dirname "$0")/.." || exit 1

LOCK=/tmp/github-backup.lock

exec 9>"$LOCK"
if ! flock -w 1800 9; then
  echo "$(date -Is) ERROR: could not acquire backup lock within 30min"
  exit 1
fi

echo "$(date -Is) starting backup run"
if node scripts/backup-to-github.mjs; then
  echo "$(date -Is) backup run finished"
else
  echo "$(date -Is) WARN: backup run failed (exit $?)"
  exit 1
fi
