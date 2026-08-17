#!/usr/bin/env bash
set -euo pipefail

TMP_DIR="tmp"
mkdir -p "$TMP_DIR"

BATCH_SIZE="${BATCH_SIZE:-50}"
AUTO_CONFIRM="${AUTO_CONFIRM:-}"

usage() {
  echo "Usage:"
  echo "  Vollständiger Audit-Workflow:"
  echo "    $0 YEAR MONTH [--persist]"
  echo "    Beispiel: $0 2026 9 --persist"
  echo ""
  echo "  Direkt-Upsert aus CSV/JSON:"
  echo "    $0 <datei.csv|datei.json> [RUN_ID] [--persist]"
  echo "    Beispiel: $0 missing_lines.csv 88030ba3-... --persist"
  echo ""
  echo "  Standard: --dry-run (Vorschau ohne DB-Änderungen)"
  echo ""
  echo "  Umgebungsvariablen:"
  echo "    BATCH_SIZE=100   Batch-Größe für Upsert (Standard: 50)"
  echo "    AUTO_CONFIRM=1   Bestätigung überspringen"
  exit 1
}

confirm_persist() {
  local count="$1"
  if [ -n "$AUTO_CONFIRM" ]; then
    echo "[AUTO_CONFIRM] Überspringe Bestätigung."
    return 0
  fi
  echo ""
  echo "╔════════════════════════════════════════╗"
  echo "║  ACHTUNG: Datenbank-Änderung           ║"
  echo "║  ${count} Zeilen werden geschrieben.     ║"
  echo "╚════════════════════════════════════════╝"
  read -r -p "Fortfahren? [j/N] " response
  case "$response" in
    [jJyY]) return 0 ;;
    *) echo "Abgebrochen."; exit 0 ;;
  esac
}

recompute_gesamtbetrag() {
  local where_clause="${1:-}"
  echo "--- Recompute: Gesamtbeträge neu berechnen ---"
  local sql="
    UPDATE monthly_invoices mi
    SET gesamtbetrag = sub.netto
    FROM (
      SELECT invoice_id,
             ROUND(CAST(SUM(amount) AS numeric), 2) AS netto
      FROM invoice_lines
      GROUP BY invoice_id
    ) sub
    WHERE mi.id = sub.invoice_id
      AND ROUND(CAST(mi.gesamtbetrag AS numeric), 2) != sub.netto
      ${where_clause}
  "
  local result
  result=$(psql "$DATABASE_URL" -t -A -c "$sql" 2>&1) || true
  local count
  count=$(echo "$result" | grep -oP 'UPDATE \K\d+' || echo "0")
  echo "  Aktualisiert: ${count} Rechnungen"
}

if [ $# -lt 1 ]; then
  usage
fi

is_file_input() {
  [[ "$1" == *.csv || "$1" == *.json ]] && [ -f "$1" ]
}

if is_file_input "${1:-}"; then
  INPUT_FILE="$1"
  RUN_ID="${2:-}"
  MODE="${3:---dry-run}"

  echo "=== ImmoflowMe Direkt-Upsert ==="
  echo "Datei: ${INPUT_FILE}"
  [ -n "$RUN_ID" ] && echo "RunId: ${RUN_ID}"
  echo "Modus: ${MODE}"
  echo ""

  UPSERT_ARGS=""
  if [[ "$INPUT_FILE" == *.csv ]]; then
    UPSERT_ARGS="--csv=${INPUT_FILE}"
  else
    UPSERT_ARGS="--json=${INPUT_FILE}"
  fi

  [ -n "$RUN_ID" ] && UPSERT_ARGS="${UPSERT_ARGS} --run-id=${RUN_ID}"
  UPSERT_ARGS="${UPSERT_ARGS} --batch-size=${BATCH_SIZE}"

  if [ "$MODE" = "--persist" ]; then
    LINES=$(wc -l < "$INPUT_FILE")
    confirm_persist "$LINES"

    echo "--- Schritt 1: Backup ---"
    bash tools/backup_invoices.sh "${TMP_DIR}/backups" "direkt_$(date +%Y%m%d)"
    echo ""

    echo "--- Schritt 2: Dry-Run Vorschau ---"
    node tools/upsert_missing_lines.js ${UPSERT_ARGS} --dry-run
    echo ""

    echo "--- Schritt 3: Upsert (${LINES} Zeilen) ---"
    node tools/upsert_missing_lines.js ${UPSERT_ARGS}
    echo ""

    echo "--- Schritt 4: Recompute Gesamtbeträge ---"
    recompute_gesamtbetrag
  else
    echo "Vorschau:"
    node tools/upsert_missing_lines.js ${UPSERT_ARGS} --dry-run
  fi

  echo ""
  echo "=== Fertig ==="
  exit 0
fi

YEAR="${1:-$(date +%Y)}"
MONTH="${2:-$(date +%-m)}"
MODE="${3:---dry-run}"

echo "=== ImmoflowMe Vorschreibungs-Audit ==="
echo "Periode: ${YEAR}-$(printf '%02d' $MONTH)"
echo "Modus: ${MODE}"
echo ""

DRYRUN_FILE="${TMP_DIR}/dryrun_${YEAR}_$(printf '%02d' $MONTH).json"
DB_FILE="${TMP_DIR}/db_lines_${YEAR}_$(printf '%02d' $MONTH).json"
MISSING_FILE="${TMP_DIR}/missing_lines_${YEAR}_$(printf '%02d' $MONTH).json"

echo "--- Schritt 1: Dry-Run erzeugen ---"
npx tsx scripts/dryrun.ts --year="$YEAR" --month="$MONTH" --output="$DRYRUN_FILE"
echo ""

echo "--- Schritt 2: DB Lines exportieren (Jahr=${YEAR}, Monat=${MONTH}) ---"
node tools/export_db_lines.js --year="$YEAR" --month="$MONTH" --out="$DB_FILE" || true
echo ""

echo "--- Schritt 3: Fehlende Zeilen finden ---"
node tools/find_missing_lines.js "$DRYRUN_FILE" "$DB_FILE" --out="$MISSING_FILE"
echo ""

MISSING_COUNT=$(node -e "try{const d=require('./${MISSING_FILE}');console.log(d.length)}catch(e){console.log(0)}")

if [ "$MISSING_COUNT" -eq 0 ]; then
  echo "Keine fehlenden Zeilen gefunden. Alles vollständig."
  exit 0
fi

echo "--- Schritt 4: Upsert fehlende Zeilen (${MODE}) ---"
if [ "$MODE" = "--persist" ]; then
  confirm_persist "$MISSING_COUNT"

  echo "--- Backup vor Persist ---"
  bash tools/backup_invoices.sh "${TMP_DIR}/backups" "${YEAR}_$(printf '%02d' $MONTH)"
  echo ""

  echo "--- Dry-Run Vorschau ---"
  node tools/upsert_missing_lines.js "$MISSING_FILE" --dry-run --batch-size="${BATCH_SIZE}"
  echo ""

  echo "--- Upsert (${MISSING_COUNT} Zeilen) ---"
  node tools/upsert_missing_lines.js "$MISSING_FILE" --batch-size="${BATCH_SIZE}"
  echo ""

  echo "--- Recompute Gesamtbeträge ---"
  YEAR_FILTER="AND mi.year = ${YEAR} AND mi.month = ${MONTH}"
  recompute_gesamtbetrag "$YEAR_FILTER"
else
  echo "Vorschau (${MISSING_COUNT} Zeilen):"
  node tools/upsert_missing_lines.js "$MISSING_FILE" --dry-run --batch-size="${BATCH_SIZE}"
fi

echo ""
echo "=== Fertig ==="
