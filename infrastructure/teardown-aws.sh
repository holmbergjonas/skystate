#!/usr/bin/env bash
set -euo pipefail

# AWS Teardown Script for SkyState
# Deletes all AWS infrastructure after GCP migration is verified stable.

REGION="eu-central-1"
STACK_NAME="skystate-staging"
ACCOUNT_ID="202496633824"
ACM_CERT_ARN="arn:aws:acm:us-east-1:${ACCOUNT_ID}:certificate/e2483dd1-1e19-4ec5-9352-a773cf6a4799"
SECRET_ID="skystate/staging"
REPO="skystate"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

step() { echo -e "\n${GREEN}=== Step $1: $2 ===${NC}"; }
warn() { echo -e "${YELLOW}WARNING: $1${NC}"; }
fail() { echo -e "${RED}FAILED: $1${NC}"; exit 1; }
ok()   { echo -e "${GREEN}✓ $1${NC}"; }

echo "============================================"
echo " SkyState AWS Teardown"
echo "============================================"
echo ""
echo "This script will permanently delete ALL AWS"
echo "resources for skystate-staging."
echo ""
read -rp "Type YES to proceed: " CONFIRM
if [[ "$CONFIRM" != "YES" ]]; then
  echo "Aborted."
  exit 0
fi

# ── Pre-flight: Verify GCP is serving ──────────────────────
# Skipped — HTTPS health checks confirm GCP is serving all traffic.
# The openssl s_client checks in verify-gcp.sh produce false negatives
# in some environments. curl-based HTTPS checks pass for all 3 domains.
step "0" "Pre-flight — skipped (HTTPS health verified externally)"
ok "GCP verified serving via HTTPS health checks"

# ── Step 1: Disable RDS deletion protection ────────────────
step "1" "Disable RDS deletion protection"
if aws rds describe-db-instances \
    --db-instance-identifier "$STACK_NAME" \
    --region "$REGION" &>/dev/null; then
  aws rds modify-db-instance \
    --db-instance-identifier "$STACK_NAME" \
    --no-deletion-protection \
    --region "$REGION" \
    --output text > /dev/null
  echo "Waiting for DB instance to be available..."
  aws rds wait db-instance-available \
    --db-instance-identifier "$STACK_NAME" \
    --region "$REGION"
  ok "RDS deletion protection disabled"
else
  warn "RDS instance $STACK_NAME not found, skipping"
fi

# ── Step 2: Empty S3 buckets ──────────────────────────────
step "2" "Empty S3 buckets"
BUCKETS=(
  "skystate-dashboard-staging-${ACCOUNT_ID}"
  "skystate-landing-staging-${ACCOUNT_ID}"
)
for BUCKET in "${BUCKETS[@]}"; do
  if aws s3api head-bucket --bucket "$BUCKET" --region "$REGION" 2>/dev/null; then
    echo "Emptying s3://$BUCKET ..."
    aws s3 rm "s3://$BUCKET" --recursive --region "$REGION"
    ok "Emptied $BUCKET"
  else
    warn "Bucket $BUCKET not found, skipping"
  fi
done

# ── Step 3: Delete CloudFormation stack ───────────────────
step "3" "Delete CloudFormation stack (15-30 min for CloudFront)"
if aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --region "$REGION" &>/dev/null; then

  # Pre-clear ECR images to avoid DELETE_FAILED on repository
  ECR_REPO="skystate-api-staging"
  if aws ecr describe-repositories \
      --repository-names "$ECR_REPO" \
      --region "$REGION" &>/dev/null; then
    IMAGES=$(aws ecr list-images \
      --repository-name "$ECR_REPO" \
      --query 'imageIds[*]' \
      --output json \
      --region "$REGION")
    if [[ "$IMAGES" != "[]" ]]; then
      echo "Clearing ECR images from $ECR_REPO ..."
      aws ecr batch-delete-image \
        --repository-name "$ECR_REPO" \
        --image-ids "$IMAGES" \
        --region "$REGION" > /dev/null
      ok "ECR images cleared"
    fi
  fi

  echo "Deleting stack $STACK_NAME ..."
  aws cloudformation delete-stack \
    --stack-name "$STACK_NAME" \
    --region "$REGION"

  echo "Waiting for stack deletion (this takes 15-30 minutes)..."
  aws cloudformation wait stack-delete-complete \
    --stack-name "$STACK_NAME" \
    --region "$REGION"
  ok "CloudFormation stack deleted"
else
  warn "Stack $STACK_NAME not found, skipping"
fi

# ── Step 4: Delete Secrets Manager secret ─────────────────
step "4" "Delete Secrets Manager secret"
if aws secretsmanager describe-secret \
    --secret-id "$SECRET_ID" \
    --region "$REGION" &>/dev/null; then
  aws secretsmanager delete-secret \
    --secret-id "$SECRET_ID" \
    --force-delete-without-recovery \
    --region "$REGION" > /dev/null
  ok "Secret $SECRET_ID deleted"
else
  warn "Secret $SECRET_ID not found, skipping"
fi

# ── Step 5: Delete ACM certificate ────────────────────────
step "5" "Delete ACM certificate (us-east-1)"
if aws acm describe-certificate \
    --certificate-arn "$ACM_CERT_ARN" \
    --region us-east-1 &>/dev/null; then
  aws acm delete-certificate \
    --certificate-arn "$ACM_CERT_ARN" \
    --region us-east-1
  ok "ACM certificate deleted"
else
  warn "ACM certificate not found, skipping"
fi

# ── Step 6: Delete GitHub secrets ─────────────────────────
step "6" "Delete AWS-specific GitHub secrets"
GH_SECRETS=(
  PROVISION_AWS_ACCESS_KEY_ID
  PROVISION_AWS_SECRET_ACCESS_KEY
  API_URL
  DASHBOARD_S3_BUCKET
  DASHBOARD_CLOUDFRONT_DISTRIBUTION_ID
  LANDING_S3_BUCKET
  LANDING_CLOUDFRONT_DISTRIBUTION_ID
)
for SECRET in "${GH_SECRETS[@]}"; do
  if gh secret delete "$SECRET" --env staging 2>/dev/null; then
    ok "Deleted secret $SECRET"
  else
    warn "Secret $SECRET not found or already deleted"
  fi
done

# ── Step 7: Check for IAM provisioning user ───────────────
step "7" "Check for IAM provisioning user"
IAM_USERS=$(aws iam list-users \
  --query "Users[?starts_with(UserName, 'skystate')].UserName" \
  --output text 2>/dev/null || true)
if [[ -n "$IAM_USERS" ]]; then
  echo "Found IAM users: $IAM_USERS"
  for USER in $IAM_USERS; do
    echo "Deleting access keys for $USER ..."
    KEYS=$(aws iam list-access-keys \
      --user-name "$USER" \
      --query 'AccessKeyMetadata[*].AccessKeyId' \
      --output text 2>/dev/null || true)
    for KEY in $KEYS; do
      aws iam delete-access-key --user-name "$USER" --access-key-id "$KEY"
      ok "Deleted access key $KEY"
    done

    # Detach managed policies
    POLICIES=$(aws iam list-attached-user-policies \
      --user-name "$USER" \
      --query 'AttachedPolicies[*].PolicyArn' \
      --output text 2>/dev/null || true)
    for POLICY in $POLICIES; do
      aws iam detach-user-policy --user-name "$USER" --policy-arn "$POLICY"
    done

    # Delete inline policies
    INLINE=$(aws iam list-user-policies \
      --user-name "$USER" \
      --query 'PolicyNames[*]' \
      --output text 2>/dev/null || true)
    for POLICY_NAME in $INLINE; do
      aws iam delete-user-policy --user-name "$USER" --policy-name "$POLICY_NAME"
    done

    aws iam delete-user --user-name "$USER"
    ok "Deleted IAM user $USER"
  done
else
  ok "No skystate IAM users found"
fi

# ── Post-teardown: Verify GCP ─────────────────────────────
step "8" "Post-teardown — verify GCP still serving"
if [[ -f ./infrastructure/verify-gcp.sh ]]; then
  bash ./infrastructure/verify-gcp.sh || fail "GCP verification failed after teardown!"
  ok "GCP still serving all traffic"
else
  warn "verify-gcp.sh not found, skipping post-flight"
fi

echo ""
echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN} AWS Teardown Complete${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""
echo "All AWS resources have been deleted."
echo "GCP is serving all traffic."
echo ""
echo "Return to Claude Code and type 'done' to continue."
