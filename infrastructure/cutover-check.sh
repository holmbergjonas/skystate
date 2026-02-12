#!/usr/bin/env bash
set -uo pipefail

# Phase 37 Cutover Check — run this to see what's ready and what's not.

echo "=== 1. Cloud Run Domain Mapping Status ==="
gcloud beta run domain-mappings describe \
  --domain=staging-api.skystate.io \
  --region=europe-west1 \
  --project=skystate-staging 2>&1
echo ""

echo "=== 2. DNS + SSL + HTTP Verification ==="
./infrastructure/verify-gcp.sh
VERIFY_EXIT=$?
echo ""

echo "=== 3. Quick Endpoint Checks ==="
echo -n "  staging-api.skystate.io/health: "
CODE=$(curl -s -o /dev/null -w '%{http_code}' https://staging-api.skystate.io/health --max-time 10 2>/dev/null || echo "ERR")
echo "$CODE"

echo -n "  staging-app.skystate.io: "
CODE=$(curl -s -o /dev/null -w '%{http_code}' https://staging-app.skystate.io --max-time 10 2>/dev/null || echo "ERR")
echo "$CODE"

echo -n "  skystate.io: "
CODE=$(curl -s -o /dev/null -w '%{http_code}' https://skystate.io --max-time 10 2>/dev/null || echo "ERR")
echo "$CODE"

echo ""
echo "=== Summary ==="
if [ "$VERIFY_EXIT" -eq 0 ]; then
  echo "All automated checks passed."
  echo "Manual step remaining: Login with GitHub at https://staging-app.skystate.io"
else
  echo "Some checks failed — see output above."
fi
