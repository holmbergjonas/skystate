#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="skystate-staging"
SA_EMAIL="skystate-deploy@${PROJECT_ID}.iam.gserviceaccount.com"

ROLES=(
  "roles/storage.admin"
  "roles/cloudsql.admin"
)

for ROLE in "${ROLES[@]}"; do
  echo "=== Granting ${ROLE} ==="
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="${ROLE}" \
    --quiet > /dev/null
done

echo ""
echo "=== Verifying bindings ==="
gcloud projects get-iam-policy "${PROJECT_ID}" \
  --flatten="bindings[].members" \
  --filter="bindings.members=serviceAccount:${SA_EMAIL}" \
  --format="table(bindings.role, bindings.members)"

echo ""
echo "Done. Re-run the failed GitHub Actions workflow."
