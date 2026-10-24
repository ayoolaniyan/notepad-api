#!/usr/bin/env bash
# End-to-end check through the gateway: health, register, create a note, read it back.
# Usage: scripts/smoke-test.sh [gateway-url]   (default http://localhost:3000)
set -euo pipefail

BASE="${1:-http://localhost:3000}"
EMAIL="smoke-$(date +%s)-$RANDOM@example.com"

# Prints a field from the JSON on stdin, e.g. json data.accessToken
json() {
    node -e 'let s = ""; process.stdin.on("data", (c) => (s += c)).on("end", () => {
        const value = process.argv[1].split(".").reduce((o, k) => o?.[k], JSON.parse(s));
        if (value === undefined) { console.error(`missing ${process.argv[1]} in ${s}`); process.exit(1); }
        console.log(value);
    });' "$1"
}

step() { echo "==> $*"; }

step "GET /health"
[ "$(curl -sS --fail-with-body "$BASE/health" | json data.status)" = "ok" ]

step "POST /api/v1/auth/register"
TOKEN=$(curl -sS --fail-with-body -X POST "$BASE/api/v1/auth/register" -H "Content-Type: application/json" \
    -d "{\"email\":\"$EMAIL\",\"password\":\"Smoke-Test-1\"}" | json data.accessToken)

step "POST /api/v1/notes"
NOTE_ID=$(curl -sS --fail-with-body -X POST "$BASE/api/v1/notes" -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" -d '{"title":"Smoke test"}' | json data.note.id)

step "GET /api/v1/notes/$NOTE_ID"
[ "$(curl -sS --fail-with-body "$BASE/api/v1/notes/$NOTE_ID" -H "Authorization: Bearer $TOKEN" | json data.note.title)" = "Smoke test" ]

step "GET /api/v1/notes without a token is rejected"
[ "$(curl -sS -o /dev/null -w '%{http_code}' "$BASE/api/v1/notes")" = "401" ]

echo "Smoke test passed"
