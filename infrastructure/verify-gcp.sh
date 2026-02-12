#!/usr/bin/env bash
set -uo pipefail

# GCP DNS Cutover Verification Script
# Checks DNS resolution, SSL certificates, and HTTP health for all custom domains.

API_DOMAIN="staging-api.skystate.io"
APP_DOMAIN="staging-app.skystate.io"
LANDING_DOMAIN="skystate.io"
EXPECTED_API_CNAME="ghs.googlehosted.com"
EXPECTED_APP_CNAME="skystate-staging-dashboard.web.app"
EXPECTED_LANDING_IP="199.36.158.100"

PASS=0
FAIL=0

check() {
  local desc="$1" cmd="$2"
  if eval "$cmd" > /dev/null 2>&1; then
    echo "  PASS: $desc"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc"
    FAIL=$((FAIL + 1))
  fi
}

dns_resolve() {
  local domain="$1" expected="$2"
  if command -v dig > /dev/null 2>&1; then
    dig +short CNAME "$domain" A "$domain" 2>/dev/null | grep -q "$expected"
  else
    getent hosts "$domain" 2>/dev/null | grep -q "$expected"
  fi
}

echo "=== DNS Resolution ==="
check "$API_DOMAIN -> $EXPECTED_API_CNAME" \
  "dns_resolve $API_DOMAIN $EXPECTED_API_CNAME"
check "$APP_DOMAIN -> $EXPECTED_APP_CNAME" \
  "dns_resolve $APP_DOMAIN $EXPECTED_APP_CNAME"
check "$LANDING_DOMAIN -> $EXPECTED_LANDING_IP" \
  "dns_resolve $LANDING_DOMAIN $EXPECTED_LANDING_IP"

echo ""
echo "=== SSL Certificates ==="
check "$API_DOMAIN SSL valid" \
  "echo | openssl s_client -connect $API_DOMAIN:443 -servername $API_DOMAIN 2>/dev/null | openssl x509 -noout -dates"
check "$APP_DOMAIN SSL valid" \
  "echo | openssl s_client -connect $APP_DOMAIN:443 -servername $APP_DOMAIN 2>/dev/null | openssl x509 -noout -dates"
check "$LANDING_DOMAIN SSL valid" \
  "echo | openssl s_client -connect $LANDING_DOMAIN:443 -servername $LANDING_DOMAIN 2>/dev/null | openssl x509 -noout -dates"

echo ""
echo "=== HTTP Health ==="
check "$API_DOMAIN /health returns 200" \
  "[ \$(curl -s -o /dev/null -w '%{http_code}' https://$API_DOMAIN/health --max-time 10) = '200' ]"
check "$APP_DOMAIN returns HTML" \
  "curl -s https://$APP_DOMAIN --max-time 10 | grep -qi '</html>'"
check "$LANDING_DOMAIN returns HTML" \
  "curl -s https://$LANDING_DOMAIN --max-time 10 | grep -qi '</html>'"

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ] || exit 1
