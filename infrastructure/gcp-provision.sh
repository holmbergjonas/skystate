#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# GCP Foundation Provisioning Script
# =============================================================================
# Enables APIs, configures Workload Identity Federation, creates a service
# account, and binds IAM roles for GitHub Actions CI/CD.
#
# This script is idempotent -- safe to re-run without errors.
#
# Usage:
#   ./infrastructure/gcp-provision.sh
#
# Override defaults via environment variables:
#   PROJECT_ID=my-project REGION=us-central1 ./infrastructure/gcp-provision.sh
# =============================================================================

# Configuration (overridable via environment variables)
PROJECT_ID="${PROJECT_ID:-skystate-staging}"
REGION="${REGION:-europe-west1}"
GITHUB_REPO="${GITHUB_REPO:-holmbergjonas/skystate}"
SA_NAME="${SA_NAME:-skystate-deploy}"
WIF_POOL="${WIF_POOL:-github}"
WIF_PROVIDER="${WIF_PROVIDER:-github-actions}"

# Derived
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

echo ""
echo "GCP Foundation Provisioning"
echo "==========================="
echo "Project:     ${PROJECT_ID}"
echo "Region:      ${REGION}"
echo "GitHub Repo: ${GITHUB_REPO}"
echo "SA Name:     ${SA_NAME}"
echo "SA Email:    ${SA_EMAIL}"
echo "WIF Pool:    ${WIF_POOL}"
echo "WIF Provider:${WIF_PROVIDER}"
echo ""

# -----------------------------------------------------------------------------
# Step 1: Enable APIs
# -----------------------------------------------------------------------------
echo "==> Enabling GCP APIs..."
gcloud services enable \
  run.googleapis.com \
  sqladmin.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  firebase.googleapis.com \
  firebasehosting.googleapis.com \
  iam.googleapis.com \
  iamcredentials.googleapis.com \
  --project="${PROJECT_ID}"
echo "    APIs enabled."

# -----------------------------------------------------------------------------
# Step 2: Create Workload Identity Pool
# -----------------------------------------------------------------------------
echo "==> Creating Workload Identity Pool..."
if gcloud iam workload-identity-pools describe "${WIF_POOL}" \
    --project="${PROJECT_ID}" \
    --location="global" \
    --format="value(name)" 2>/dev/null; then
  echo "    Pool '${WIF_POOL}' already exists, skipping."
else
  gcloud iam workload-identity-pools create "${WIF_POOL}" \
    --project="${PROJECT_ID}" \
    --location="global" \
    --display-name="GitHub Actions Pool"
  echo "    Pool '${WIF_POOL}' created."
fi

# -----------------------------------------------------------------------------
# Step 3: Create WIF OIDC Provider
# -----------------------------------------------------------------------------
echo "==> Creating Workload Identity Provider..."
if gcloud iam workload-identity-pools providers describe "${WIF_PROVIDER}" \
    --project="${PROJECT_ID}" \
    --location="global" \
    --workload-identity-pool="${WIF_POOL}" \
    --format="value(name)" 2>/dev/null; then
  echo "    Provider '${WIF_PROVIDER}' already exists, skipping."
else
  gcloud iam workload-identity-pools providers create-oidc "${WIF_PROVIDER}" \
    --project="${PROJECT_ID}" \
    --location="global" \
    --workload-identity-pool="${WIF_POOL}" \
    --display-name="GitHub Actions Provider" \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.actor=assertion.actor,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner" \
    --attribute-condition="assertion.repository == '${GITHUB_REPO}'"
  echo "    Provider '${WIF_PROVIDER}' created."
fi

# -----------------------------------------------------------------------------
# Step 4: Create Service Account
# -----------------------------------------------------------------------------
echo "==> Creating service account..."
if gcloud iam service-accounts describe "${SA_EMAIL}" \
    --project="${PROJECT_ID}" \
    --format="value(email)" 2>/dev/null; then
  echo "    Service account '${SA_EMAIL}' already exists, skipping."
else
  gcloud iam service-accounts create "${SA_NAME}" \
    --project="${PROJECT_ID}" \
    --display-name="SkyState Deploy (GitHub Actions)"
  echo "    Service account '${SA_NAME}' created."
fi

# -----------------------------------------------------------------------------
# Step 5: Bind IAM Roles
# -----------------------------------------------------------------------------
echo "==> Binding IAM roles..."
ROLES=(
  "roles/run.admin"
  "roles/artifactregistry.writer"
  "roles/cloudsql.client"              # Cloud Run connection to Cloud SQL
  "roles/cloudsql.admin"               # gcloud sql import sql (CI/CD migration)
  "roles/secretmanager.secretAccessor"
  "roles/iam.serviceAccountUser"
  "roles/firebasehosting.admin"
  "roles/storage.admin"                # Create/delete migration buckets (CI/CD)
)

for ROLE in "${ROLES[@]}"; do
  echo "    Binding ${ROLE}..."
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="${ROLE}" \
    --quiet > /dev/null
done
echo "    All IAM roles bound."

# -----------------------------------------------------------------------------
# Step 6: Bind WIF Impersonation
# -----------------------------------------------------------------------------
echo "==> Binding Workload Identity Federation..."
PROJECT_NUMBER=$(gcloud projects describe "${PROJECT_ID}" --format="value(projectNumber)")

gcloud iam service-accounts add-iam-policy-binding "${SA_EMAIL}" \
  --project="${PROJECT_ID}" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${WIF_POOL}/attribute.repository/${GITHUB_REPO}" \
  --quiet > /dev/null
echo "    WIF impersonation binding created."

# -----------------------------------------------------------------------------
# Step 7: Create Artifact Registry Repository
# -----------------------------------------------------------------------------
echo "==> Creating Artifact Registry repository..."
AR_REPO="skystate-api"
if gcloud artifacts repositories describe "${AR_REPO}" \
    --project="${PROJECT_ID}" \
    --location="${REGION}" \
    --format="value(name)" 2>/dev/null; then
  echo "    Repository '${AR_REPO}' already exists, skipping."
else
  gcloud artifacts repositories create "${AR_REPO}" \
    --project="${PROJECT_ID}" \
    --location="${REGION}" \
    --repository-format=docker \
    --description="SkyState API Docker images"
  echo "    Repository '${AR_REPO}' created."
fi

# -----------------------------------------------------------------------------
# Step 8: Set Artifact Registry Cleanup Policy
# -----------------------------------------------------------------------------
echo "==> Setting Artifact Registry cleanup policy..."
cat > /tmp/ar-cleanup-policy.json << 'POLICY'
[
  {
    "name": "keep-last-10",
    "action": {"type": "Keep"},
    "mostRecentVersions": {
      "keepCount": 10
    }
  }
]
POLICY

gcloud artifacts repositories set-cleanup-policies "${AR_REPO}" \
  --project="${PROJECT_ID}" \
  --location="${REGION}" \
  --policy=/tmp/ar-cleanup-policy.json \
  --no-dry-run
echo "    Cleanup policy applied (keep last 10 versions)."

# -----------------------------------------------------------------------------
# Step 9: Create Cloud SQL Instance
# -----------------------------------------------------------------------------
echo "==> Creating Cloud SQL instance..."
INSTANCE_NAME="skystate-db"
if gcloud sql instances describe "${INSTANCE_NAME}" \
    --project="${PROJECT_ID}" \
    --format="value(name)" 2>/dev/null; then
  echo "    Instance '${INSTANCE_NAME}' already exists, skipping."
else
  gcloud sql instances create "${INSTANCE_NAME}" \
    --project="${PROJECT_ID}" \
    --database-version=POSTGRES_17 \
    --edition=ENTERPRISE \
    --tier=db-f1-micro \
    --region="${REGION}" \
    --availability-type=ZONAL \
    --backup-start-time=03:00 \
    --retained-backups-count=7 \
    --storage-size=10 \
    --storage-type=HDD
  echo "    Instance '${INSTANCE_NAME}' created."
fi

# Create application database
echo "==> Creating database..."
if gcloud sql databases describe skystate \
    --instance="${INSTANCE_NAME}" \
    --project="${PROJECT_ID}" \
    --format="value(name)" 2>/dev/null; then
  echo "    Database 'skystate' already exists, skipping."
else
  gcloud sql databases create skystate \
    --instance="${INSTANCE_NAME}" \
    --project="${PROJECT_ID}"
  echo "    Database 'skystate' created."
fi

# Create application user (with auto-generated password)
echo "==> Creating database user..."
if gcloud sql users list \
    --instance="${INSTANCE_NAME}" \
    --project="${PROJECT_ID}" \
    --format="value(name)" \
    --filter="name=skystate" 2>/dev/null | grep -q skystate; then
  echo "    User 'skystate' already exists, skipping."
  # Retrieve existing password from Secret Manager (needed for create_secret below)
  DB_PASSWORD=$(gcloud secrets versions access latest \
    --secret=skystate-db-password \
    --project="${PROJECT_ID}" 2>/dev/null || echo "")
else
  # Auto-generate 32-char password
  DB_PASSWORD=$(head -c 256 /dev/urandom | tr -dc 'A-Za-z0-9' | head -c 32)
  gcloud sql users create skystate \
    --instance="${INSTANCE_NAME}" \
    --project="${PROJECT_ID}" \
    --password="${DB_PASSWORD}"
  echo "    User 'skystate' created."
fi

# -----------------------------------------------------------------------------
# Step 10: Create Secret Manager Secrets
# -----------------------------------------------------------------------------
echo "==> Creating Secret Manager secrets..."

# Helper function: create secret if it doesn't exist
create_secret() {
  local SECRET_NAME="$1"
  local SECRET_VALUE="$2"
  if gcloud secrets describe "${SECRET_NAME}" \
      --project="${PROJECT_ID}" \
      --format="value(name)" 2>/dev/null; then
    echo "    Secret '${SECRET_NAME}' already exists, skipping."
  else
    echo -n "${SECRET_VALUE}" | gcloud secrets create "${SECRET_NAME}" \
      --project="${PROJECT_ID}" \
      --replication-policy="automatic" \
      --data-file=-
    echo "    Secret '${SECRET_NAME}' created."
  fi
}

# 1. DB password (auto-generated above)
create_secret "skystate-db-password" "${DB_PASSWORD}"

# 2-6. Interactive prompts (secrets never written to disk)
echo ""
echo "Enter secret values for Secret Manager."
echo "(Values are piped directly to gcloud -- never written to disk.)"
echo ""

read -rp "Enter GitHub Client ID: " GITHUB_CLIENT_ID
create_secret "skystate-github-client-id" "${GITHUB_CLIENT_ID}"

read -rp "Enter GitHub Client Secret: " GITHUB_CLIENT_SECRET
create_secret "skystate-github-client-secret" "${GITHUB_CLIENT_SECRET}"

read -rp "Enter Stripe Secret Key: " STRIPE_SECRET_KEY
create_secret "skystate-stripe-secret-key" "${STRIPE_SECRET_KEY}"

read -rp "Enter Stripe Webhook Secret: " STRIPE_WEBHOOK_SECRET
create_secret "skystate-stripe-webhook-secret" "${STRIPE_WEBHOOK_SECRET}"

read -rp "Enter JWT Signing Key: " JWT_SIGNING_KEY
create_secret "skystate-jwt-signing-key" "${JWT_SIGNING_KEY}"

# NOTE: The deploy service account already has roles/secretmanager.secretAccessor
# bound in Step 5 above, so no additional IAM binding is needed.

# -----------------------------------------------------------------------------
# Step 11: Output Summary
# -----------------------------------------------------------------------------
echo ""
echo "==> Provisioning complete!"
echo ""
echo "Project Number:  ${PROJECT_NUMBER}"
echo "Service Account: ${SA_EMAIL}"
echo "Cloud SQL:       ${INSTANCE_NAME} (${REGION}, db-f1-micro, POSTGRES_17)"
echo "Database:        skystate"
echo "Secrets:         6 secrets in Secret Manager (skystate-* prefix)"
echo ""
echo "WIF Provider Path (use in GitHub Actions workflows):"
echo "  projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${WIF_POOL}/providers/${WIF_PROVIDER}"
echo ""
echo "NOTE: IAM changes may take up to 5 minutes to propagate."
echo "      Wait before running the GitHub Actions test workflow."
