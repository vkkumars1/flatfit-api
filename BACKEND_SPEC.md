# ROLE
You are a senior backend engineer. Build the complete FlatFit backend (Node.js + Express + TypeScript) for the existing FlatFit Next.js frontend. Work phase by phase, commit after each phase, and run the tests before moving on. Do not ask me questions unless truly blocked; make a sensible choice, and record it in docs/DECISIONS.md.

# GOAL
A real, secure, fully working API that the frontend calls with NEXT_PUBLIC_USE_MOCKS=false. Every endpoint below must work locally and after deployment. EVERYTHING MUST USE FREE SERVICES ONLY. Do not add any paid service, paid SDK or card-required signup.

# STACK (fixed)
Node 20, Express, TypeScript (strict), Prisma, PostgreSQL on Supabase, Supabase Storage (signed upload URLs), Socket.io, Zod, jsonwebtoken, bcryptjs (for hashing OTPs and refresh tokens), helmet, cors, express-rate-limit, cookie-parser, pino + pino-http, swagger-ui-express, Vitest + Supertest, tsx for dev, Razorpay SDK (TEST mode only), in-memory cache (node-cache or a small Map with TTL). NO Redis, NO AWS, NO paid SMS.

# FOLDER STRUCTURE (layered)
src/
  config/env.ts            # Zod-validated env. The app must refuse to start if a variable is missing.
  app.ts                   # builds the Express app (used by tests)
  server.ts                # starts HTTP + Socket.io
  middleware/              # requireAuth, requireRole, validate, rateLimiters, errorHandler, notFound
  routes/                  # one file per module, only wiring
  controllers/             # parse request, call service, send response
  services/                # business logic (matching, otp, payments, storage)
  repositories/            # all Prisma queries live here
  sockets/                 # socket auth + event handlers
  lib/                     # prisma client, jwt, hash, logger, cache, supabase, errors
  validators/              # Zod schemas (one per endpoint)
prisma/schema.prisma, prisma/seed.ts
tests/                     # Supertest per endpoint + Vitest for the matching score
docs/                      # DECISIONS.md, API.md, DEPLOY.md
.github/workflows/         # ci.yml, keepalive.yml
.env.example, README.md, render.yaml (optional)

# ENVIRONMENT VARIABLES (all validated in config/env.ts)
NODE_ENV, PORT, DATABASE_URL (Supabase pooler, pgbouncer=true), DIRECT_URL (for migrations), JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, ACCESS_TTL=15m, REFRESH_TTL=7d, FRONTEND_ORIGIN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_BUCKET=flatfit-public, DEMO_MODE (true/false), DEMO_PHONE, DEMO_OTP=123456, RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET (all optional: if missing, PAYMENTS_MODE=mock), LOG_LEVEL.
# Secrets stay on the server only. .env is in .gitignore. Commit only .env.example.

# DATABASE (Prisma models, with indexes)
User(id, phone unique, email?, name, gender, dob, role USER|ADMIN, plan FREE|VERIFIED|BOOST, createdAt)
Profile(userId unique, bio, city, budgetMin, budgetMax, moveInDate, occupation, mode HAS_FLAT|NEEDS_FLAT, photos String[])
Lifestyle(userId unique, sleepTime, wakeTime (minutes from midnight), cleanliness 1-5, smoking, drinking, pets, diet, guestsLevel 1-5, noiseLevel 1-5, cooking)
DealBreaker(userId, key, value)  # unique(userId,key)
Listing(id, ownerId, title, city, locality, rent, deposit, photos String[], amenities String[], availableFrom, verified, createdAt)
Swipe(fromUser, toUser, action LIKE|PASS|SUPER)  # unique(fromUser,toUser)
Match(id, userA, userB, score, createdAt)  # unique(userA,userB) with userA < userB always
Message(id, matchId, senderId, text, createdAt, readAt?)
Verification(id, userId, type PHONE|EMAIL|SELFIE, status NONE|PENDING|VERIFIED|REJECTED, path?, reviewedBy?)
Report(id, reporterId, targetId, reason, details)
Block(blockerId, blockedId)  # unique pair
Agreement(id, matchId unique, rules Json, acceptedByA, acceptedByB)
Payment(id, userId, plan, amount, status CREATED|PAID|FAILED, razorpayOrderId, razorpayPaymentId?)
OtpCode(id, phone, codeHash, expiresAt, attempts, usedAt?)
RefreshToken(id, userId, tokenHash, expiresAt, revokedAt?)
# Indexes: Swipe(toUser), Match(userA), Match(userB), Message(matchId, createdAt), Listing(city, rent), Profile(city), Block(blockedId).

# THE API (exact paths and shapes, because the frontend already uses them)
# Errors always look like { error: { code, message, details? } } with correct HTTP codes (400, 401, 403, 404, 409, 429, 500).
# Lists use cursor pagination: { items, nextCursor }, default 20, max 50.

System: GET /health -> { status:"ok", db:true|false, time }  (runs SELECT 1 so it also keeps Supabase awake)

Auth
 POST /auth/send-otp { phone } -> { ok:true, resendInSeconds:30 }
 POST /auth/verify-otp { phone, otp } -> { accessToken, user:{id,name,role,plan}, isNewUser } and sets the refresh cookie (httpOnly, Secure in production, SameSite=Lax, path /auth)
 POST /auth/refresh -> { accessToken, user } (reads the cookie, rotates the refresh token, detects reuse and revokes the family)
 POST /auth/logout -> 204 (revokes the token, clears the cookie)
 # OTP rules: 6 digits, stored HASHED, expires in 5 minutes, max 5 wrong attempts, then locked. If DEMO_MODE=true and the phone equals DEMO_PHONE (or any phone in demo), the code is DEMO_OTP. Use an OtpProvider interface with a ConsoleProvider (logs the code in dev) and an MSG91Provider stub, so real SMS can be plugged in later. Never return or log the OTP in production.

Me
 GET /me -> { user, profile, lifestyle, dealBreakers, verification:{phone,email,selfie}, plan }
 PUT /me/profile { name, gender, dob, city, bio, budgetMin, budgetMax, moveInDate, occupation, mode, photos }
 PUT /me/lifestyle { sleepTime, wakeTime, cleanliness, smoking, drinking, pets, diet, guestsLevel, noiseLevel, cooking }
 PUT /me/deal-breakers [ { key, value } ]
 POST /me/photos/upload-url { fileType, fileSize, purpose } -> { uploadUrl, path, publicUrl }
 # Allow only jpeg/png/webp, max 5 MB. Path = {purpose}/{userId}/{uuid}.{ext}. Use supabase.storage.from(bucket).createSignedUploadUrl(path). Selfies go to a PRIVATE bucket (flatfit-private).
 # When saving photo paths in PUT /me/profile, check every path starts with the user's own folder, so nobody can claim another user's file.

Discovery and matches
 GET /discover?cursor=&city=&min=&max= -> { items:[{ userId, name, age, city, photos, score, topReasons, lifestyleChips, budgetMin, budgetMax }], nextCursor }
 POST /swipes { toUserId, action } -> { matched, matchId? }
 GET /matches?cursor= -> { items:[{ matchId, otherUser, score, lastMessage, unreadCount }], nextCursor }
 GET /matches/:id/compatibility -> { score, breakdown:[{ label, weight, score }], reasons:{ good:[], bad:[] } }
 GET /matches/:id/messages?cursor= -> { items:[{ id, senderId, text, createdAt, readAt }], nextCursor }
 POST /matches/:id/messages { text } -> message (max 1000 chars, sanitized)
 # Every /matches/:id/* route first checks that the logged-in user is part of that match (otherwise 404, to avoid leaking that it exists). This prevents IDOR.

Agreement
 GET /matches/:id/agreement, POST /matches/:id/agreement { rules }, PUT /agreements/:id/accept
 # Editing rules after anyone accepted resets both acceptances. Rules schema: guests, quietHours, dishes, bills, cleaning, smoking, pets.

Listings
 GET /listings?city=&min=&max=&verified=&cursor=, GET /listings/:id, POST /listings, PUT /listings/:id (owner only), DELETE /listings/:id (owner only)
 # Never return the exact address, only city and locality.

Safety
 POST /reports { targetUserId, reason, details }, GET /blocks, POST /blocks { targetUserId }, DELETE /blocks/:userId
 POST /verify/selfie { path } -> status PENDING. (Simulated verification: no paid face-matching API.)
 # Blocked users never appear in /discover, /matches, or chat, in either direction.

Payments (Razorpay TEST mode)
 POST /payments/order { plan } -> { orderId, amount, keyId }  (amounts: VERIFIED 19900 paise, BOOST 29900 paise, set from a constants file)
 POST /payments/webhook  (raw body; verify the X-Razorpay-Signature with RAZORPAY_WEBHOOK_SECRET; on payment.captured mark Payment PAID and update User.plan; idempotent)
 # If Razorpay keys are missing, PAYMENTS_MODE=mock: the order endpoint returns a fake order and a dev-only route POST /payments/mock-confirm (disabled unless DEMO_MODE=true) upgrades the plan.

Admin (role ADMIN only)
 GET /admin/verifications?cursor= (pending selfies with a short-lived signed URL to view), PUT /admin/verifications/:id { status:"approved"|"rejected" }

Socket.io (same server)
 Authenticate in the handshake with the access token. Each user joins room "user:{id}". Events: client "typing" {matchId}, "read" {matchId}; server "message", "typing", "read", "match". Check match membership on every event. Persist messages in Postgres first, then emit.

# MATCHING ENGINE (services/matching.ts, pure functions, unit tested)
Hard filters first (candidate is excluded if any fails): same city, budget ranges overlap, not blocked either way, not already swiped by me, not me, no deal-breaker clash in either direction (e.g. my "smoking: never" vs their smoking=true), gender preference fits.
Weighted score 0-100:
 sleep schedule 25%  -> 1 - min(4, circular hour difference of sleepTime and wakeTime)/4
 cleanliness 20%     -> 1 - |a-b|/4
 smoking + drinking 15% -> equal = 1, one differs = 0.4, both differ = 0
 guests + noise 15%  -> 1 - average(|a-b|)/4
 budget closeness 15% -> overlap length / union length of the two ranges
 pets, diet, cooking 10% -> share of matching fields
Return the breakdown with the same labels and weights, plus topReasons (best 3 factors as plain sentences like "Both sleep before 11 PM") and good/bad reasons.
Sort by score descending, tie-break by id, paginate with a cursor (score + id). A mutual LIKE or SUPER creates the Match inside a transaction (store score), and emits the "match" socket event to both users. Cache the discover candidate IDs per user for 60 seconds, and clear them on swipe or profile change.

# SECURITY CHECKLIST (all 20 points must be satisfied; add a test for each that can be tested)
1 No secrets in code or git; 2 requireAuth on every route except /health, /auth/send-otp, /auth/verify-otp, /auth/refresh, /payments/webhook; requireRole for admin; 3 Prisma only, no raw SQL strings (the one SELECT 1 uses tagged $queryRaw); 4 sanitize text (strip HTML tags) on bio, chat, listing text; helmet; 5 OTPs and refresh tokens are hashed, JWT secrets 32+ chars; 6 CORS only for FRONTEND_ORIGIN with credentials; 7 .gitignore has .env; 8 rate limits: send-otp 3 per 10 min per phone and IP, verify-otp 10 per 10 min, global 100 per minute per IP, messages 30 per minute per user, all returning 429 with Retry-After; 9 ownership checks on every :id route (IDOR); 10 npm audit in CI plus Dependabot config; 11 schema as above; 12 indexes and Prisma include to avoid N+1; 13 in-memory cache with TTL; 14 central errorHandler that never leaks stack traces in production; 15 pino logs with a request id, no tokens, OTPs or phone numbers in logs; 16 migrations in git, seed script, docs/DEPLOY.md with a backup note (pg_dump); 17 tests; 18 layered structure; 19 small commits per phase; 20 every important function has a short "# why" comment in simple English.
Extra: body size limit 100kb (webhook uses raw body), Zod validate body, query and params on every route, cursor limits, helmet, trust proxy for Render, graceful shutdown.

# QUALITY AND PROOF THAT EVERY ENDPOINT WORKS
1. Swagger UI at /docs from a hand-written OpenAPI file (docs/openapi.yaml) that covers every endpoint above.
2. Supertest: at least one success test and one failure test (401, 403 or 404) per endpoint; Vitest unit tests for each matching factor and the final score.
3. prisma/seed.ts creates: 1 admin, 1 demo user (DEMO_PHONE), 50 realistic Indian users in Gurugram, Bangalore and Pune with lifestyles, 12 listings, 5 matches with chat history, 2 pending selfies. It must be safe to run twice.
4. A Postman collection (postman/flatfit.postman_collection.json) that runs the full flow in order against {{baseUrl}}: send-otp, verify-otp, me, profile, lifestyle, upload-url, discover, swipes, matches, messages, agreement, listings CRUD, report, block, payments order, admin. It uses test scripts to assert status codes, and works with newman.
5. scripts/smoke.ts: runs the same flow against BASE_URL and prints a PASS/FAIL table. Add "npm run smoke".

# DEPLOYMENT (free)
- Supabase: create project, create buckets flatfit-public (public) and flatfit-private (private), copy the pooler URL into DATABASE_URL and the direct URL into DIRECT_URL.
- Render free web service: build "npm ci && npx prisma generate && npm run build", start "npx prisma migrate deploy && node dist/server.js". Write the exact steps in docs/DEPLOY.md and a render.yaml.
- Set FRONTEND_ORIGIN to the Vercel URL. In production set DEMO_MODE=true only for the showcase and say so in the README.
- .github/workflows/ci.yml: install, lint, typecheck, test, npm audit (fail on high).
- .github/workflows/keepalive.yml: runs daily on a cron schedule and calls GET {{BACKEND_URL}}/health (URL from a GitHub secret). It fails visibly if the status is not 200, so a red mark shows when something is down. Document that Render may still sleep after about 15 minutes idle, and that the frontend has a "Waking up the server" screen for that.

# PHASES (commit after each, run tests, then continue)
1 Project setup, env validation, app/server, health, logger, error handling, security middleware.
2 Prisma schema, migrations, seed script.
3 Auth: OTP, JWT, refresh rotation, logout, requireAuth, rate limits. Tests.
4 Me endpoints and Supabase signed uploads. Tests.
5 Matching engine, discover, swipes, matches, compatibility. Tests.
6 Chat REST + Socket.io. Tests.
7 Agreement, listings, safety (reports, blocks, selfie), admin. Tests.
8 Payments (Razorpay test mode + mock mode). Tests.
9 Swagger, Postman collection, smoke script, CI, keep-alive workflow, README, DEPLOY.md.
10 Final audit: run the 20-point checklist, npm audit, a full smoke test, and print a table of every endpoint with PASS/FAIL.

# DEFINITION OF DONE
- npm run typecheck, lint, test and smoke all pass locally.
- Every endpoint in this spec exists and matches the paths and response shapes above exactly (the frontend depends on them).
- No paid service is required anywhere.
- README explains setup in simple English: install, .env, migrate, seed, run, test, deploy, and how to connect the Vercel frontend (BACKEND_URL and NEXT_PUBLIC_SOCKET_URL, NEXT_PUBLIC_USE_MOCKS=false).
- At the end, give me a short list of any assumptions you made and anything that needs my manual action (creating the Supabase project, buckets and env vars).