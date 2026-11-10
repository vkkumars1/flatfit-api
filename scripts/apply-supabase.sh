#!/usr/bin/env bash
# why: one-shot Supabase wiring. Rewrites .env with user creds, runs migrate + seed + smoke.
set -euo pipefail

if [ "$#" -lt 4 ]; then
  cat <<USAGE
Usage: scripts/apply-supabase.sh DATABASE_URL DIRECT_URL SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY

Where (from supabase.com → Project Settings):
  DATABASE_URL  = pooler URL (port 6543) — paste as-is, script appends ?pgbouncer=true&connection_limit=1 if missing
  DIRECT_URL    = direct URL (port 5432)
  SUPABASE_URL  = https://<ref>.supabase.co
  SUPABASE_SERVICE_ROLE_KEY = service_role secret (NOT anon)
USAGE
  exit 1
fi

DB_URL="$1"
DIRECT="$2"
SB_URL="$3"
SB_KEY="$4"

if ! echo "$DB_URL" | grep -q "pgbouncer=true"; then
  if echo "$DB_URL" | grep -q "?"; then
    DB_URL="${DB_URL}&pgbouncer=true&connection_limit=1"
  else
    DB_URL="${DB_URL}?pgbouncer=true&connection_limit=1"
  fi
fi

# why: preserve JWT secrets + frontend origin, swap DB + Supabase values atomically
cp .env .env.bak
cat > .env <<ENV
NODE_ENV=development
PORT=4000
LOG_LEVEL=info
FRONTEND_ORIGIN=https://flatmate-five-zeta.vercel.app

DATABASE_URL=${DB_URL}
DIRECT_URL=${DIRECT}

JWT_ACCESS_SECRET=gd_jRDOp6-06ZHbOvhK_SvV3SlM9SfQRRK4xZdIvpd84I9lg1kXNAqdFogVg56eD
JWT_REFRESH_SECRET=zP4FH8HIIhL5UGuLmJzS1kvaDOPlm4NOPdfLRZoTWP_ZiZuObCp_e35a4msoR_DY
ACCESS_TTL=15m
REFRESH_TTL=7d

SUPABASE_URL=${SB_URL}
SUPABASE_SERVICE_ROLE_KEY=${SB_KEY}
SUPABASE_BUCKET=flatfit-public
SUPABASE_PRIVATE_BUCKET=flatfit-private

DEMO_MODE=true
DEMO_PHONE=+919999999999
DEMO_OTP=123456

RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=
ENV

echo "==> .env updated (old backed up to .env.bak)"
echo "==> npx prisma migrate deploy"
npx prisma migrate deploy
echo "==> npm run seed"
npm run seed
echo "==> started dev server in background; waiting for /health"
pkill -f "tsx watch src/server.ts" 2>/dev/null || true
nohup npm run dev > /tmp/flatfit-dev.log 2>&1 &
sleep 4
for i in 1 2 3 4 5 6 7 8; do
  if curl -s http://localhost:4000/health | grep -q '"db":true'; then
    echo "==> /health: db=true"
    break
  fi
  sleep 1
done
echo "==> BASE_URL=http://localhost:4000 npm run smoke"
BASE_URL=http://localhost:4000 npm run smoke
echo "==> DONE. Supabase wired, DB migrated, seeded, smoke green."
