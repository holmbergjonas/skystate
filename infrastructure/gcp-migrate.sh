#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# Cloud SQL Schema Migration
# =============================================================================
# Applies api/Database/installation.sql and api/Database/migrations.sql to the
# Cloud SQL instance (skystate-db) using gcloud sql import sql via Cloud Storage.
#
# Both files are run in order: installation.sql first, then migrations.sql.
# Both files are idempotent — safe to run multiple times.
#
# WHY NOT Cloud SQL Auth Proxy?
# The original plan was to use Auth Proxy from a local machine (psql < installation.sql).
# However, this instance uses --no-assign-ip (private IP only). The Auth Proxy for
# private IP requires the client to be on the same VPC -- local machines are not.
# Instead, we use gcloud sql import sql via Cloud Storage, which uses the Cloud SQL
# Admin API and works regardless of network configuration.
# See: 33-RESEARCH.md, Pitfall 2 for full details.
#
# Usage:
#   ./infrastructure/gcp-migrate.sh
#
# Override defaults via environment variables:
#   PROJECT_ID=my-project ./infrastructure/gcp-migrate.sh
# =============================================================================

# Configuration (overridable via environment variables)
PROJECT_ID="${PROJECT_ID:-skystate-staging}"
REGION="${REGION:-europe-west1}"
INSTANCE_NAME="${INSTANCE_NAME:-skystate-db}"
DB_NAME="${DB_NAME:-skystate}"
DB_USER="${DB_USER:-skystate}"
BUCKET="gs://${PROJECT_ID}-db-migration"
SQL_FILE="api/Database/installation.sql"
MIGRATIONS_FILE="api/Database/migrations.sql"

echo ""
echo "Cloud SQL Schema Migration"
echo "=========================="
echo "Project:         ${PROJECT_ID}"
echo "Instance:        ${INSTANCE_NAME}"
echo "Database:        ${DB_NAME}"
echo "User:            ${DB_USER}"
echo "SQL File:        ${SQL_FILE}"
echo "Migrations File: ${MIGRATIONS_FILE}"
echo "Bucket:          ${BUCKET}"
echo ""

# -----------------------------------------------------------------------------
# Step 1: Verify SQL files exist
# -----------------------------------------------------------------------------
echo "==> Verifying SQL files..."
[ -f "${SQL_FILE}" ] || { echo "ERROR: ${SQL_FILE} not found. Run from repo root."; exit 1; }
[ -f "${MIGRATIONS_FILE}" ] || { echo "ERROR: ${MIGRATIONS_FILE} not found. Run from repo root."; exit 1; }
echo "    Found ${SQL_FILE}."
echo "    Found ${MIGRATIONS_FILE}."

# -----------------------------------------------------------------------------
# Step 2: Create temporary Cloud Storage bucket
# -----------------------------------------------------------------------------
echo "==> Creating temporary migration bucket..."
if gcloud storage buckets describe "${BUCKET}" \
    --project="${PROJECT_ID}" \
    --format="value(name)" 2>/dev/null; then
  echo "    Bucket already exists, reusing."
else
  gcloud storage buckets create "${BUCKET}" \
    --project="${PROJECT_ID}" \
    --location="${REGION}"
  echo "    Bucket created."
fi

# -----------------------------------------------------------------------------
# Step 3: Upload schema and migrations files
# -----------------------------------------------------------------------------
echo "==> Uploading schema file..."
gcloud storage cp "${SQL_FILE}" "${BUCKET}/installation.sql"
echo "    Schema file uploaded."
echo "==> Uploading migrations file..."
gcloud storage cp "${MIGRATIONS_FILE}" "${BUCKET}/migrations.sql"
echo "    Migrations file uploaded."

# -----------------------------------------------------------------------------
# Step 4: Grant Cloud SQL instance service account read access
# -----------------------------------------------------------------------------
echo "==> Granting Cloud SQL instance SA read access to bucket..."
INSTANCE_SA=$(gcloud sql instances describe "${INSTANCE_NAME}" \
  --project="${PROJECT_ID}" \
  --format="value(serviceAccountEmailAddress)")
echo "    Instance SA: ${INSTANCE_SA}"

gcloud storage buckets add-iam-policy-binding "${BUCKET}" \
  --member="serviceAccount:${INSTANCE_SA}" \
  --role="roles/storage.objectViewer"
echo "    IAM binding created."

# -----------------------------------------------------------------------------
# Step 5: Wait for IAM propagation
# -----------------------------------------------------------------------------
echo "Waiting 10s for IAM propagation..."
sleep 10

# -----------------------------------------------------------------------------
# Step 6: Import schema
# -----------------------------------------------------------------------------
echo "==> Importing schema into Cloud SQL..."
gcloud sql import sql "${INSTANCE_NAME}" "${BUCKET}/installation.sql" \
  --project="${PROJECT_ID}" \
  --database="${DB_NAME}" \
  --user="${DB_USER}" \
  --quiet
echo "    Schema import completed."

# -----------------------------------------------------------------------------
# Step 6b: Import migrations
# -----------------------------------------------------------------------------
echo "==> Importing migrations..."
gcloud sql import sql "${INSTANCE_NAME}" "${BUCKET}/migrations.sql" \
  --project="${PROJECT_ID}" \
  --database="${DB_NAME}" \
  --user="${DB_USER}" \
  --quiet
echo "    Migrations import completed."

# -----------------------------------------------------------------------------
# Step 7: Verify key tables exist
# -----------------------------------------------------------------------------
echo "==> Verifying key tables..."

# Create verification SQL that fails if any key table is missing
VERIFY_SQL=$(mktemp)
cat > "${VERIFY_SQL}" << 'EOSQL'
-- Verify key tables exist (will error if any table is missing)
SELECT 1 FROM "user" LIMIT 0;
SELECT 1 FROM project LIMIT 0;
SELECT 1 FROM environment LIMIT 0;
SELECT 1 FROM project_state LIMIT 0;
EOSQL

gcloud storage cp "${VERIFY_SQL}" "${BUCKET}/verify-tables.sql"
rm "${VERIFY_SQL}"

echo "Verifying key tables exist (user, project, environment, project_state)..."
if gcloud sql import sql "${INSTANCE_NAME}" "${BUCKET}/verify-tables.sql" \
    --project="${PROJECT_ID}" --database="${DB_NAME}" --user="${DB_USER}" --quiet; then
  echo "    Table verification passed: all 4 key tables exist."
else
  echo "ERROR: Table verification failed -- one or more key tables missing."
  gcloud storage rm -r "${BUCKET}"
  exit 1
fi

# -----------------------------------------------------------------------------
# Step 8: Cleanup
# -----------------------------------------------------------------------------
echo "==> Cleaning up migration bucket..."
gcloud storage rm -r "${BUCKET}"
echo "    Bucket removed."

# -----------------------------------------------------------------------------
# Done
# -----------------------------------------------------------------------------
echo ""
echo "==> Schema migration complete!"
echo ""
echo "Instance:  ${INSTANCE_NAME}"
echo "Database:  ${DB_NAME}"
echo "Tables:    user, project, environment, project_state (verified)"
echo ""
echo "NOTE: Full functional verification happens when the API connects in Phase 34."
