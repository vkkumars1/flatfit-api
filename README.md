# FlatFit API

Backend for the FlatFit roommate-matching web app. Runs on free tiers: Supabase (DB + storage) and Render (HTTP).

## Prereqs
- Node 20+
- A Supabase project with two buckets (`flatfit-public`, `flatfit-private`)

## Setup
```bash
npm install
cp .env.example .env    # then fill in Supabase values
npx prisma generate
npx prisma migrate deploy
npm run seed
npm run dev             # http://localhost:4000
```

## Scripts
- `npm run dev` - watch mode
- `npm run build` - compile TS
- `npm start` - run compiled
- `npm run typecheck` - tsc --noEmit
- `npm run lint` - eslint
- `npm run test` - vitest
- `npm run seed` - seed DB
- `npm run smoke` - black-box smoke test against `BASE_URL`

## Env variables
See `.env.example` for the full list. Required vs optional is documented there.

## Docs
- Swagger UI: http://localhost:4000/docs
- OpenAPI source: `docs/openapi.yaml`
- Postman: `postman/flatfit.postman_collection.json` (run with `npm run postman`)

## Connecting the frontend
Point the Next.js frontend at this API:
```
NEXT_PUBLIC_API_URL=http://localhost:4000
NEXT_PUBLIC_SOCKET_URL=http://localhost:4000
NEXT_PUBLIC_USE_MOCKS=false
```
