#!/usr/bin/env bash
# why: post-Render-deploy smoke. Confirms live API answers before touching Vercel env.
set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "Usage: scripts/verify-deploy.sh https://flatfit-api-XXXX.onrender.com"
  exit 1
fi

URL="${1%/}"
echo "==> Target: $URL"
echo ""

echo "--- GET $URL/health"
curl -s -o /tmp/health.json -w "HTTP %{http_code}\n" "$URL/health"
cat /tmp/health.json
echo ""
echo ""

echo "--- GET $URL/docs (Swagger UI)"
curl -s -o /dev/null -w "HTTP %{http_code}\n" "$URL/docs"

echo "--- POST $URL/auth/send-otp +919999999999"
curl -s -X POST "$URL/auth/send-otp" \
  -H "Content-Type: application/json" \
  -H "Origin: https://flatmate-five-zeta.vercel.app" \
  -d '{"phone":"+919999999999"}' \
  -w "\nHTTP %{http_code}\n"
echo ""

echo "--- POST $URL/auth/verify-otp (DEMO_OTP 123456)"
RESP=$(curl -s -X POST "$URL/auth/verify-otp" \
  -H "Content-Type: application/json" \
  -H "Origin: https://flatmate-five-zeta.vercel.app" \
  -d '{"phone":"+919999999999","otp":"123456"}')
echo "$RESP"
TOKEN=$(echo "$RESP" | sed -n 's/.*"accessToken":"\([^"]*\)".*/\1/p')
if [ -n "$TOKEN" ]; then
  echo ""
  echo "--- GET $URL/me (auth)"
  curl -s "$URL/me" -H "Authorization: Bearer $TOKEN" -w "\nHTTP %{http_code}\n" | head -40
  echo ""
  echo "--- GET $URL/discover (auth)"
  curl -s "$URL/discover" -H "Authorization: Bearer $TOKEN" -w "\nHTTP %{http_code}\n" | head -5
fi

echo ""
echo "==> If all HTTP codes are 200, your Render deploy is healthy."
echo "==> Next: set Vercel envs then redeploy frontend:"
echo "    NEXT_PUBLIC_API_URL=$URL"
echo "    NEXT_PUBLIC_SOCKET_URL=$URL"
echo "    NEXT_PUBLIC_USE_MOCKS=false"
