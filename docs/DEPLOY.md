# Deploying FlatFit (free)

## 1. Supabase
1. Sign up at https://supabase.com
2. Create a project (region nearest to you).
3. Create two storage buckets:
   - `flatfit-public` (public)
   - `flatfit-private` (private, for selfies)
4. Copy these values into the backend `.env`:
   - DATABASE_URL (pooler, append `?pgbouncer=true&connection_limit=1`)
   - DIRECT_URL (for migrations)
   - SUPABASE_URL
   - SUPABASE_SERVICE_ROLE_KEY

## 2. Local run
```
npm install
npx prisma generate
npx prisma migrate deploy   # or: npm run prisma:migrate for dev
npm run seed
npm run dev
```

## 3. Render (free web service)
1. Create a new Web Service pointing at this repo.
2. Build: `npm ci && npx prisma generate && npm run build`
3. Start: `npx prisma migrate deploy && node dist/server.js`
4. Add every `.env.example` variable in the Render dashboard.
5. Set `FRONTEND_ORIGIN` to your Vercel URL (e.g. `https://flatmate-five-zeta.vercel.app`).

## 4. Keep-alive
`.github/workflows/keepalive.yml` hits `/health` daily. Add a repo secret `BACKEND_URL`.

## 5. Backups
Weekly: `pg_dump "$DIRECT_URL" > backups/$(date +%F).sql`
