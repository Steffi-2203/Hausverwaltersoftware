#!/usr/bin/env bash
set -euo pipefail

# Load test: generate properties, units, tenants for CI smoke tests
# Usage: bash tools/load_test_bulk.sh [num_properties] [units_per_property] [database_url]
# Column names match shared/schema.ts exactly

NUM_PROPERTIES=${1:-10}
UNITS_PER_PROPERTY=${2:-100}
DB_URL="${3:-${DATABASE_URL:-}}"
TOTAL_UNITS=$((NUM_PROPERTIES * UNITS_PER_PROPERTY))

echo "=== ImmoflowMe Load Test ==="
echo "Properties: $NUM_PROPERTIES"
echo "Units per property: $UNITS_PER_PROPERTY"
echo "Total units: $TOTAL_UNITS"
echo ""

if [ -z "$DB_URL" ]; then
  echo "ERROR: No database URL provided (3rd arg or DATABASE_URL env)"
  exit 1
fi

PSQL="psql $DB_URL --no-psqlrc -tA"

ORG_ID=$($PSQL -c "SELECT id FROM organizations LIMIT 1" | head -1 | tr -d '[:space:]')
if [ -z "$ORG_ID" ]; then
  echo "ERROR: No organization found"
  exit 1
fi
echo "Using organization: $ORG_ID"

START_TIME=$(date +%s)

for p in $(seq 1 $NUM_PROPERTIES); do
  PROP_NAME="Lasttest Liegenschaft $p"
  PROP_ID=$($PSQL -c "
    INSERT INTO properties (id, organization_id, name, address, postal_code, city)
    VALUES (gen_random_uuid(), '$ORG_ID', '$PROP_NAME', 'Teststrasse $p', '1${p}00', 'Wien')
    RETURNING id;
  " | head -1 | tr -d '[:space:]')
  echo "Property $p: $PROP_ID"

  UNIT_SQL=""
  for u in $(seq 1 $UNITS_PER_PROPERTY); do
    TOP="Top $u"
    NW="$((10 + RANDOM % 90)).$((RANDOM % 100))"
    FL="$((30 + RANDOM % 100)).$((RANDOM % 100))"
    UNIT_SQL="${UNIT_SQL}INSERT INTO units (id, property_id, top_nummer, nutzwert, flaeche, type, status) VALUES (gen_random_uuid(), '${PROP_ID}', '${TOP}', '${NW}', '${FL}', 'wohnung', 'aktiv');"
  done
  echo "$UNIT_SQL" | $PSQL -q

  UNIT_IDS=$($PSQL -c "SELECT id FROM units WHERE property_id = '$PROP_ID'")

  TENANT_SQL=""
  while IFS= read -r UNIT_ID; do
    UNIT_ID=$(echo "$UNIT_ID" | tr -d '[:space:]')
    [ -z "$UNIT_ID" ] && continue
    MIETE="$((300 + RANDOM % 700)).$((RANDOM % 100))"
    BK="$((50 + RANDOM % 150)).$((RANDOM % 100))"
    HK="$((20 + RANDOM % 80)).$((RANDOM % 100))"
    RN=$((RANDOM))
    TENANT_SQL="${TENANT_SQL}INSERT INTO tenants (id, unit_id, first_name, last_name, email, grundmiete, betriebskosten_vorschuss, heizungskosten_vorschuss, status, mietbeginn) VALUES (gen_random_uuid(), '${UNIT_ID}', 'Test', 'Mieter-${RN}', 'test${RN}@example.com', '${MIETE}', '${BK}', '${HK}', 'aktiv', '2025-01-01');"
  done <<< "$UNIT_IDS"
  echo "$TENANT_SQL" | $PSQL -q
  echo "  Created $UNITS_PER_PROPERTY units + tenants"
done

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

echo ""
echo "=== Results ==="
echo "Duration: ${DURATION}s"
echo "Properties created: $NUM_PROPERTIES"
echo "Units created: $TOTAL_UNITS"
echo "Tenants created: $TOTAL_UNITS"
echo ""

echo "=== Acceptance Gates ==="
ACTUAL_UNITS=$($PSQL -c "SELECT COUNT(*) FROM units WHERE property_id IN (SELECT id FROM properties WHERE name LIKE 'Lasttest%')" | head -1 | tr -d '[:space:]')
ACTUAL_TENANTS=$($PSQL -c "SELECT COUNT(*) FROM tenants WHERE unit_id IN (SELECT id FROM units WHERE property_id IN (SELECT id FROM properties WHERE name LIKE 'Lasttest%'))" | head -1 | tr -d '[:space:]')

echo "Units: $ACTUAL_UNITS (expected: $TOTAL_UNITS)"
echo "Tenants: $ACTUAL_TENANTS (expected: $TOTAL_UNITS)"

if [ "$ACTUAL_UNITS" -ge "$TOTAL_UNITS" ] && [ "$ACTUAL_TENANTS" -ge "$TOTAL_UNITS" ]; then
  echo "PASS: All acceptance gates met"
else
  echo "FAIL: Data count mismatch"
  exit 1
fi

echo ""
echo "=== API Response Time Test ==="
echo "Test pagination on /api/units (requires running server)..."
echo "(Run manually: curl -s -w '%{time_total}' 'http://localhost:5000/api/units?page=1&limit=50')"
