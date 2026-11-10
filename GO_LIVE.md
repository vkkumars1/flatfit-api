# Go-live checklist

Local full-stack already works (docker postgres + seeded data + 9/9 smoke). These
two steps move it to the public internet. Each step takes about 60 seconds.

## 1. Supabase → prod Postgres + buckets

1. https://supabase.com → **New project**
   - Name: `flatfit`
   - Region: Mumbai or Singapore
   - DB password: generate strong, copy somewhere safe
2. **Project Settings → Database** → copy both:
   - Connection string → **Session pooler** (port 6543) → `DATABASE_URL`
   - Connection string → **Direct** (port 5432) → `DIRECT_URL`
   - Replace `[YOUR-PASSWORD]` placeholder with the DB password
3. **Project Settings → API** → copy:
   - **Project URL** → `SUPABASE_URL`
   - **service_role** secret (NOT anon) → `SUPABASE_SERVICE_ROLE_KEY`
4. **Storage** → two new buckets:
   - `flatfit-public` → **Public** ON
   - `flatfit-private` → **Public** OFF
5. Run the one-shot:
   ```bash
   cd /Users/mac/PREP/flatfit-api
   ./scripts/apply-supabase.sh \
     "postgresql://postgres.XXXX:PASSWORD@aws-0-REGION.pooler.supabase.com:6543/postgres" \
     "postgresql://postgres.XXXX:PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres" \
     "https://XXXX.supabase.co" \
     "eyJ...service_role_key"
   ```
   The script: rewrites `.env` (backs up to `.env.bak`), runs `prisma migrate deploy`,
   seeds 52 users + 12 listings + 5 matches + 2 selfies, boots dev server, runs smoke.
   Expect `9/9 PASS`.

## 2. Render → public API host

1. https://render.com → **Sign in with GitHub**
2. **New +** → **Web Service** → connect repo `vkkumars1/flatfit-api`
3. Render auto-reads `render.yaml`. Confirm:
   - Plan: **Free**
   - Build: `npm ci && npx prisma generate && npm run build`
   - Start: `npx prisma migrate deploy && node dist/server.js`
4. **Environment** tab → paste the 7 secrets (same values from step 1 `.env`):
   - `DATABASE_URL`, `DIRECT_URL`
   - `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` (from `.env`)
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
   - `FRONTEND_ORIGIN=https://flatmate-five-zeta.vercel.app`
5. **Create Web Service** → wait ~2 min for first build
6. Copy the live URL (e.g. `https://flatfit-api-abcd.onrender.com`)
7. Verify:
   ```bash
   ./scripts/verify-deploy.sh https://flatfit-api-abcd.onrender.com
   ```
   All HTTP codes should be `200`.
8. **Enable keepalive** → GitHub repo → **Settings → Secrets → Actions** → new
   secret `BACKEND_URL` = your Render URL. Free-tier Render sleeps after 15 min idle;
   the `.github/workflows/keepalive.yml` cron hits `/health` daily to keep it warm.

## 3. Vercel → point frontend at Render

1. https://vercel.com → project **flatmate-five-zeta** → **Settings → Environment Variables**
2. Add three (Production scope):
   - `NEXT_PUBLIC_API_URL` = your Render URL
   - `NEXT_PUBLIC_SOCKET_URL` = your Render URL
   - `NEXT_PUBLIC_USE_MOCKS` = `false`
3. **Deployments → latest → Redeploy**
4. Open https://flatmate-five-zeta.vercel.app/
   - Login: `+919999999999` / OTP `123456`
   - You'll see real seeded users on `/discover`, real matches, real chat.

Done. Fully dynamic, fully live.
