#!/bin/bash
BASE="${1:-http://localhost:5000}"
PASS=0
FAIL=0
RESULTS=""

check() {
  local desc="$1" url="$2" expected="$3"
  status=$(curl -s -o /dev/null -w "%{http_code}" "$url" 2>/dev/null)
  if [ "$status" = "$expected" ]; then
    RESULTS+="  [PASS] $desc (HTTP $status)\n"
    ((PASS++))
  else
    RESULTS+="  [FAIL] $desc (expected $expected, got $status)\n"
    ((FAIL++))
  fi
}

check_json_field() {
  local desc="$1" url="$2" expected_field="$3" expected_val="$4"
  body=$(curl -s "$url" 2>/dev/null)
  val=$(echo "$body" | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8');try{const j=JSON.parse(d);console.log(j['$expected_field']??'__MISSING__')}catch{console.log('__PARSE_ERR__')}" 2>/dev/null)
  if [ "$val" = "$expected_val" ]; then
    RESULTS+="  [PASS] $desc ($expected_field=$val)\n"
    ((PASS++))
  else
    RESULTS+="  [FAIL] $desc ($expected_field expected=$expected_val got=$val)\n"
    ((FAIL++))
  fi
}

echo "============================================"
echo " ImmoflowMe Smoke Test Suite"
echo " $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo " Target: $BASE"
echo "============================================"
echo ""

echo "--- Infrastructure ---"
check_json_field "Health endpoint" "$BASE/api/health" "status" "ok"
check_json_field "DB connected" "$BASE/api/health" "database" "connected"
check_json_field "Readiness probe" "$BASE/api/ready" "ready" "true"
check_json_field "Startup probe" "$BASE/api/startup" "started" "true"

echo "--- Authentication ---"
check "Admin auth (unauthenticated)" "$BASE/api/auth/user" "401"
check_json_field "Tenant session (unauthenticated)" "$BASE/api/tenant-auth/session" "authenticated" "false"

echo "--- Protected API Endpoints ---"
check "Properties API" "$BASE/api/properties" "401"
check "Tenants API" "$BASE/api/tenants" "401"
check "Units API" "$BASE/api/units" "401"
check "Invoices API" "$BASE/api/invoices" "401"
check "Payments API" "$BASE/api/payments" "401"
check "Leases API" "$BASE/api/leases/1" "401"
check "Readonly API (no key)" "$BASE/api/readonly/properties" "401"

echo "--- Public Endpoints ---"
check "Landing page" "$BASE/" "200"
check "Manifest.json" "$BASE/manifest.json" "200"
check "CSRF token" "$BASE/api/csrf-token" "200"

echo "--- Tenant Portal ---"
check "Tenant login page" "$BASE/mieter-login" "200"

echo ""
echo -e "$RESULTS"
echo "============================================"
echo " Results: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  echo " STATUS: SOME CHECKS FAILED"
  exit 1
else
  echo " STATUS: ALL CHECKS PASSED"
  exit 0
fi
