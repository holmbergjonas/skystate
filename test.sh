#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

failed=()

run() {
  local log
  log=$(mktemp)
  printf "  %-25s" "$1"
  if (eval "$2") >"$log" 2>&1; then
    echo "✓"
  else
    echo "✗"
    failed+=("$1")
    cat "$log"
  fi
  rm -f "$log"
}

run "API unit tests"        "dotnet test api/SkyState.Api.UnitTests/"
run "API integration tests" "dotnet test api/SkyState.Api.IntegrationTests/"
run "API E2E tests"         "dotnet test api/SkyState.Api.EndToEndTests/"

# CLI
run "CLI install"    "cd cli && npm ci"
run "CLI lint"       "cd cli && npm run lint"
run "CLI typecheck"  "cd cli && npm run typecheck"
run "CLI tests"      "cd cli && npm test"
run "CLI E2E tests"  "cd cli && npm run test:e2e"

# Dashboard
run "Dashboard install" "cd dashboard && npm ci"
run "Dashboard build"   "cd dashboard && npm run build"
run "Dashboard tests"   "cd dashboard && npm test"
run "Dashboard E2E"     "cd dashboard && npm run test:e2e"

# Protocol
run "Protocol install" "cd packages/protocol && npm ci"
run "Protocol tests"   "cd packages/protocol && npm test"

# Results
echo "════════════════════════"
if [ ${#failed[@]} -eq 0 ]; then
  echo "All passed."
else
  echo -e "\033[31mFailed (${#failed[@]}):\033[0m"
  for f in "${failed[@]}"; do echo -e "  \033[31m✗ $f\033[0m"; done
  exit 1
fi
