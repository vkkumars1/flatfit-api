#!/usr/bin/env bash
# bootstrap.sh - materialises the full FlatFit backend codebase.
# Idempotent: safe to re-run; overwrites generated files.
set -euo pipefail
cd "$(dirname "$0")"

echo "==> Creating directories"
mkdir -p src/{config,controllers,lib,middleware,repositories,routes,services,sockets,validators}
mkdir -p prisma tests scripts docs postman .github/workflows

# ----------------------------------------------------------------------------
# src/lib
# ----------------------------------------------------------------------------
cat > src/lib/prisma.ts <<'EOF'
import { PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';

// why: single PrismaClient across the app avoids pool exhaustion on serverless.
export const prisma = new PrismaClient({
  log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});
EOF

cat > src/lib/cache.ts <<'EOF'
import NodeCache from 'node-cache';

// why: tiny in-memory cache keeps the hot discover list fast without Redis.
export const cache = new NodeCache({ stdTTL: 60, checkperiod: 120 });

export function cacheKey(...parts: (string | number)[]): string {
  return parts.join(':');
}
EOF

cat > src/lib/hash.ts <<'EOF'
import bcrypt from 'bcryptjs';

// why: 10 rounds is CPU-cheap enough for OTP/refresh-token hashes at scale.
const ROUNDS = 10;

export const hash = (plain: string) => bcrypt.hash(plain, ROUNDS);
export const verifyHash = (plain: string, hashed: string) => bcrypt.compare(plain, hashed);
EOF

cat > src/lib/jwt.ts <<'EOF'
import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env.js';

export type AccessPayload = { sub: string; role: 'USER' | 'ADMIN'; plan: 'FREE' | 'VERIFIED' | 'BOOST' };
export type RefreshPayload = { sub: string; jti: string };

// why: short-lived access + long-lived refresh is the standard pattern for safety.
export function signAccess(p: AccessPayload): string {
  const opts: SignOptions = { expiresIn: env.ACCESS_TTL as any };
  return jwt.sign(p, env.JWT_ACCESS_SECRET, opts);
}

export function signRefresh(p: RefreshPayload): string {
  const opts: SignOptions = { expiresIn: env.REFRESH_TTL as any };
  return jwt.sign(p, env.JWT_REFRESH_SECRET, opts);
}

export function verifyAccess(token: string): AccessPayload {
  return jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessPayload;
}

export function verifyRefresh(token: string): RefreshPayload {
  return jwt.verify(token, env.JWT_REFRESH_SECRET) as RefreshPayload;
}
EOF

cat > src/lib/supabase.ts <<'EOF'
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';

// why: service-role key is backend-only; never leaks to the browser.
let client: SupabaseClient | null = null;
export function supabase(): SupabaseClient {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Supabase not configured');
  }
  if (!client) {
    client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
  }
  return client;
}

export const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
EOF

cat > src/lib/sanitize.ts <<'EOF'
// why: strip HTML to stop stored XSS in bios, chats and listings.
export function stripHtml(input: string): string {
  return String(input ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .trim();
}
EOF

# ----------------------------------------------------------------------------
# src/middleware
# ----------------------------------------------------------------------------
cat > src/middleware/errorHandler.ts <<'EOF'
import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { env } from '../config/env.js';

// why: one shape for every error so the frontend can parse it consistently.
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: err.flatten() } });
    return;
  }
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } });
    return;
  }
  logger.error({ err }, 'unhandled error');
  const message = env.NODE_ENV === 'production' ? 'Internal server error' : String((err as Error)?.message ?? err);
  res.status(500).json({ error: { code: 'INTERNAL', message } });
};
EOF

cat > src/middleware/notFound.ts <<'EOF'
import type { RequestHandler } from 'express';
export const notFound: RequestHandler = (_req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
};
EOF

cat > src/middleware/rateLimiters.ts <<'EOF'
import rateLimit from 'express-rate-limit';
import type { RequestHandler } from 'express';

// why: separate limiters per sensitive route to stop brute force and spam.
export const globalLimiter: RequestHandler = rateLimit({
  windowMs: 60_000,
  limit: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many requests' } },
});

export const sendOtpLimiter: RequestHandler = rateLimit({
  windowMs: 10 * 60_000,
  limit: 3,
  keyGenerator: (req) => `${(req.body as any)?.phone ?? ''}|${req.ip ?? ''}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many OTP requests' } },
});

export const verifyOtpLimiter: RequestHandler = rateLimit({
  windowMs: 10 * 60_000,
  limit: 10,
  keyGenerator: (req) => `${(req.body as any)?.phone ?? ''}|${req.ip ?? ''}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many OTP attempts' } },
});

export const messageLimiter: RequestHandler = rateLimit({
  windowMs: 60_000,
  limit: 30,
  keyGenerator: (req) => (req as any).user?.id ?? req.ip ?? 'anon',
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Slow down' } },
});
EOF

cat > src/middleware/requireAuth.ts <<'EOF'
import type { RequestHandler } from 'express';
import { verifyAccess } from '../lib/jwt.js';
import { Unauthorized } from '../lib/errors.js';

export interface AuthedRequest {
  user: { id: string; role: 'USER' | 'ADMIN'; plan: 'FREE' | 'VERIFIED' | 'BOOST' };
}

// why: every protected route needs to know who is calling before doing anything.
export const requireAuth: RequestHandler = (req, _res, next) => {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return next(Unauthorized('Missing bearer token'));
  try {
    const payload = verifyAccess(h.slice(7));
    (req as any).user = { id: payload.sub, role: payload.role, plan: payload.plan };
    next();
  } catch {
    next(Unauthorized('Invalid or expired token'));
  }
};
EOF

cat > src/middleware/requireRole.ts <<'EOF'
import type { RequestHandler } from 'express';
import { Forbidden } from '../lib/errors.js';

export const requireRole = (role: 'ADMIN' | 'USER'): RequestHandler => (req, _res, next) => {
  if ((req as any).user?.role !== role) return next(Forbidden('Forbidden'));
  next();
};
EOF

cat > src/middleware/validate.ts <<'EOF'
import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';

type Where = 'body' | 'query' | 'params';
// why: Zod validates every request so bad input never reaches services.
export const validate = (schema: ZodType<any>, where: Where = 'body'): RequestHandler => (req, _res, next) => {
  const result = schema.safeParse((req as any)[where]);
  if (!result.success) return next(result.error);
  (req as any)[where] = result.data;
  next();
};
EOF

# ----------------------------------------------------------------------------
# src/routes/health.ts  and  src/app.ts  and  src/server.ts
# ----------------------------------------------------------------------------
cat > src/routes/health.ts <<'EOF'
import { Router } from 'express';
import { prisma } from '../lib/prisma.js';

export const healthRouter = Router();

// why: SELECT 1 also pings Supabase so free plans do not freeze.
healthRouter.get('/health', async (_req, res) => {
  let db = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    db = true;
  } catch {
    db = false;
  }
  res.json({ status: 'ok', db, time: new Date().toISOString() });
});
EOF

cat > src/app.ts <<'EOF'
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import YAML from 'yaml';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { errorHandler } from './middleware/errorHandler.js';
import { notFound } from './middleware/notFound.js';
import { globalLimiter } from './middleware/rateLimiters.js';
import { healthRouter } from './routes/health.js';
import { authRouter } from './routes/auth.js';
import { meRouter } from './routes/me.js';
import { discoverRouter } from './routes/discover.js';
import { swipesRouter } from './routes/swipes.js';
import { matchesRouter } from './routes/matches.js';
import { agreementRouter } from './routes/agreement.js';
import { listingsRouter } from './routes/listings.js';
import { safetyRouter } from './routes/safety.js';
import { adminRouter } from './routes/admin.js';
import { paymentsRouter, rawWebhookBody } from './routes/payments.js';

export function buildApp() {
  const app = express();
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(cors({ origin: env.FRONTEND_ORIGIN, credentials: true }));
  app.use(cookieParser());
  app.use(pinoHttp({ logger, customProps: () => ({}), serializers: {
    req: (req: any) => ({ id: req.id, method: req.method, url: req.url }),
  } }));

  // why: webhook needs raw bytes to verify the HMAC signature.
  app.use('/payments/webhook', rawWebhookBody);
  app.use(express.json({ limit: '100kb' }));
  app.use(globalLimiter);

  // Swagger
  try {
    const openapi = YAML.parse(readFileSync(resolve('docs/openapi.yaml'), 'utf8'));
    app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapi));
  } catch (e) {
    logger.warn({ err: e }, 'openapi.yaml not loaded');
  }

  app.use(healthRouter);
  app.use('/auth', authRouter);
  app.use('/me', meRouter);
  app.use('/discover', discoverRouter);
  app.use('/swipes', swipesRouter);
  app.use('/matches', matchesRouter);
  app.use(agreementRouter);
  app.use('/listings', listingsRouter);
  app.use(safetyRouter);
  app.use('/admin', adminRouter);
  app.use('/payments', paymentsRouter);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
EOF

cat > src/server.ts <<'EOF'
import 'dotenv/config';
import { createServer } from 'node:http';
import { Server as IOServer } from 'socket.io';
import { env } from './config/env.js';
import { buildApp } from './app.js';
import { logger } from './lib/logger.js';
import { attachSockets } from './sockets/index.js';

const app = buildApp();
const http = createServer(app);
const io = new IOServer(http, {
  cors: { origin: env.FRONTEND_ORIGIN, credentials: true },
});
attachSockets(io);

const server = http.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, 'FlatFit API listening');
});

function shutdown(sig: string) {
  logger.info({ sig }, 'graceful shutdown');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
EOF

# ----------------------------------------------------------------------------
# prisma/schema.prisma
# ----------------------------------------------------------------------------
cat > prisma/schema.prisma <<'EOF'
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}

enum Role { USER ADMIN }
enum Plan { FREE VERIFIED BOOST }
enum ListingMode { HAS_FLAT NEEDS_FLAT }
enum SwipeAction { LIKE PASS SUPER }
enum VerificationType { PHONE EMAIL SELFIE }
enum VerificationStatus { NONE PENDING VERIFIED REJECTED }
enum PaymentStatus { CREATED PAID FAILED }

model User {
  id         String   @id @default(cuid())
  phone      String   @unique
  email      String?
  name       String
  gender     String
  dob        DateTime
  role       Role     @default(USER)
  plan       Plan     @default(FREE)
  createdAt  DateTime @default(now())
  profile       Profile?
  lifestyle     Lifestyle?
  dealBreakers  DealBreaker[]
  listings      Listing[]
  payments      Payment[]
  verifications Verification[]
}

model Profile {
  userId       String   @id
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  bio          String   @default("")
  city         String
  budgetMin    Int
  budgetMax    Int
  moveInDate   DateTime
  occupation   String
  mode         ListingMode
  photos       String[] @default([])
  @@index([city])
}

model Lifestyle {
  userId      String @id
  user        User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  sleepTime   Int
  wakeTime    Int
  cleanliness Int
  smoking     Boolean @default(false)
  drinking    Boolean @default(false)
  pets        Boolean @default(false)
  diet        String  @default("any")
  guestsLevel Int     @default(3)
  noiseLevel  Int     @default(3)
  cooking     String  @default("sometimes")
}

model DealBreaker {
  id     String @id @default(cuid())
  userId String
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  key    String
  value  String
  @@unique([userId, key])
}

model Listing {
  id            String   @id @default(cuid())
  ownerId       String
  owner         User     @relation(fields: [ownerId], references: [id], onDelete: Cascade)
  title         String
  city          String
  locality      String
  rent          Int
  deposit       Int      @default(0)
  bills         Int      @default(0)
  description   String   @default("")
  photos        String[] @default([])
  amenities     String[] @default([])
  availableFrom DateTime
  verified      Boolean  @default(false)
  createdAt     DateTime @default(now())
  @@index([city, rent])
}

model Swipe {
  id        String      @id @default(cuid())
  fromUser  String
  toUser    String
  action    SwipeAction
  createdAt DateTime    @default(now())
  @@unique([fromUser, toUser])
  @@index([toUser])
}

model Match {
  id        String    @id @default(cuid())
  userA     String
  userB     String
  score     Int
  createdAt DateTime  @default(now())
  messages  Message[]
  agreement Agreement?
  @@unique([userA, userB])
  @@index([userA])
  @@index([userB])
}

model Message {
  id        String   @id @default(cuid())
  matchId   String
  match     Match    @relation(fields: [matchId], references: [id], onDelete: Cascade)
  senderId  String
  text      String
  createdAt DateTime @default(now())
  readAt    DateTime?
  @@index([matchId, createdAt])
}

model Verification {
  id         String             @id @default(cuid())
  userId     String
  user       User               @relation(fields: [userId], references: [id], onDelete: Cascade)
  type       VerificationType
  status     VerificationStatus @default(NONE)
  path       String?
  reviewedBy String?
  createdAt  DateTime           @default(now())
  updatedAt  DateTime           @updatedAt
}

model Report {
  id         String   @id @default(cuid())
  reporterId String
  targetId   String
  reason     String
  details    String?
  createdAt  DateTime @default(now())
}

model Block {
  id        String   @id @default(cuid())
  blockerId String
  blockedId String
  createdAt DateTime @default(now())
  @@unique([blockerId, blockedId])
  @@index([blockedId])
}

model Agreement {
  id            String   @id @default(cuid())
  matchId       String   @unique
  match         Match    @relation(fields: [matchId], references: [id], onDelete: Cascade)
  rules         Json
  acceptedByA   Boolean  @default(false)
  acceptedByB   Boolean  @default(false)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}

model Payment {
  id                String        @id @default(cuid())
  userId            String
  user              User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  plan              Plan
  amount            Int
  status            PaymentStatus @default(CREATED)
  razorpayOrderId   String        @unique
  razorpayPaymentId String?
  createdAt         DateTime      @default(now())
}

model OtpCode {
  id        String    @id @default(cuid())
  phone     String
  codeHash  String
  expiresAt DateTime
  attempts  Int       @default(0)
  usedAt    DateTime?
  createdAt DateTime  @default(now())
  @@index([phone, createdAt])
}

model RefreshToken {
  id         String    @id @default(cuid())
  userId     String
  tokenHash  String
  familyId   String
  expiresAt  DateTime
  revokedAt  DateTime?
  createdAt  DateTime  @default(now())
  @@index([userId])
  @@index([familyId])
}
EOF

# ----------------------------------------------------------------------------
# prisma/seed.ts
# ----------------------------------------------------------------------------
cat > prisma/seed.ts <<'EOF'
import { PrismaClient, Plan, Role, ListingMode, VerificationType, VerificationStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';

const prisma = new PrismaClient();

const CITIES = ['Gurugram', 'Bangalore', 'Pune'];
const FIRST = ['Aarav','Diya','Ishaan','Anaya','Vivaan','Myra','Reyansh','Aarohi','Krishna','Saanvi','Ayaan','Kiara','Kabir','Rhea','Arjun','Isha','Dev','Zoya','Rudra','Pari','Yash','Tara','Vihaan','Siya','Aarush','Meera','Shaurya','Ira','Veer','Avni'];
const LAST = ['Mehta','Shah','Kapoor','Verma','Iyer','Nair','Reddy','Rao','Khanna','Malhotra','Patel','Joshi','Gupta','Bhat','Sinha'];
const OCCUPATIONS = ['Engineer','Designer','Analyst','Doctor','Teacher','PM','Founder','Writer','Consultant'];

function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random()*arr.length)]!; }
function rand(a: number, b: number): number { return a + Math.floor(Math.random() * (b - a + 1)); }
function iso(y: number, m: number, d: number): Date { return new Date(Date.UTC(y, m - 1, d)); }

async function upsertUser(phone: string, patch: any = {}) {
  const name = patch.name ?? `${pick(FIRST)} ${pick(LAST)}`;
  return prisma.user.upsert({
    where: { phone },
    update: {},
    create: {
      phone,
      name,
      gender: patch.gender ?? pick(['male','female','other']),
      dob: patch.dob ?? iso(1998, 1, 1),
      role: patch.role ?? Role.USER,
      plan: patch.plan ?? Plan.FREE,
      email: patch.email ?? null,
    },
  });
}

async function profile(userId: string, city: string, mode: ListingMode) {
  const min = rand(10, 30) * 1000;
  return prisma.profile.upsert({
    where: { userId },
    update: {},
    create: {
      userId,
      bio: `Looking for a tidy flatmate in ${city}.`,
      city,
      budgetMin: min,
      budgetMax: min + rand(5, 20) * 1000,
      moveInDate: iso(2026, 1, 15),
      occupation: pick(OCCUPATIONS),
      mode,
      photos: [],
    },
  });
}

async function lifestyle(userId: string) {
  return prisma.lifestyle.upsert({
    where: { userId },
    update: {},
    create: {
      userId,
      sleepTime: rand(21*60, 25*60) % (24*60),
      wakeTime:  rand(5*60, 9*60),
      cleanliness: rand(2, 5),
      smoking: Math.random() < 0.15,
      drinking: Math.random() < 0.4,
      pets: Math.random() < 0.25,
      diet: pick(['any','vegetarian','vegan','eggetarian']),
      guestsLevel: rand(1, 5),
      noiseLevel:  rand(1, 5),
      cooking: pick(['never','sometimes','often']),
    },
  });
}

async function listing(ownerId: string, city: string) {
  const rent = rand(12, 40) * 1000;
  return prisma.listing.create({
    data: {
      ownerId, city,
      locality: pick(['Sector 56','Indiranagar','Koramangala','Baner','Viman Nagar','Sushant Lok','Golf Course Rd','Whitefield']),
      title: pick(['Sunny room in 3BHK','Quiet nook near metro','Spacious balcony flat','Cozy studio near park']),
      rent,
      deposit: rent * 2,
      bills: rand(1, 3) * 1000,
      description: 'Well-maintained, flatmate-friendly place with natural light and good ventilation.',
      photos: [],
      amenities: pick([['WiFi','AC','Washer'],['WiFi','Gym'],['Parking','WiFi','Lift']]),
      availableFrom: iso(2026, 1, pick([1,5,10,15,20])),
      verified: Math.random() < 0.6,
    },
  });
}

async function main() {
  // Admin
  const admin = await upsertUser('+911111111111', { name: 'FlatFit Admin', role: Role.ADMIN, gender: 'other' });
  await prisma.verification.upsert({ where: { id: `v-admin-phone` }, update: {}, create: { id: 'v-admin-phone', userId: admin.id, type: VerificationType.PHONE, status: VerificationStatus.VERIFIED } });

  // Demo user (matches DEMO_PHONE default from env)
  const demoPhone = process.env.DEMO_PHONE ?? '+919999999999';
  const demo = await upsertUser(demoPhone, { name: 'Demo User', plan: Plan.VERIFIED });
  await profile(demo.id, 'Gurugram', ListingMode.NEEDS_FLAT);
  await lifestyle(demo.id);

  // 50 users spread across 3 cities
  const users = [demo];
  for (let i = 0; i < 50; i++) {
    const city = CITIES[i % CITIES.length]!;
    const mode = (i % 2 === 0 ? ListingMode.HAS_FLAT : ListingMode.NEEDS_FLAT);
    const u = await upsertUser(`+9188000${String(10000 + i).slice(-5)}`);
    await profile(u.id, city, mode);
    await lifestyle(u.id);
    users.push(u);
  }

  // 12 listings
  const existing = await prisma.listing.count();
  if (existing < 12) {
    for (let i = existing; i < 12; i++) {
      const owner = users[1 + (i % (users.length - 1))]!;
      await listing(owner.id, CITIES[i % 3]!);
    }
  }

  // 5 matches with 2-3 messages each
  for (let i = 0; i < 5; i++) {
    const a = users[1]!.id; // demo
    const b = users[2 + i]!.id;
    const [userA, userB] = a < b ? [a, b] : [b, a];
    const match = await prisma.match.upsert({
      where: { userA_userB: { userA, userB } },
      update: {},
      create: { userA, userB, score: 70 + i * 4 },
    });
    const exists = await prisma.message.count({ where: { matchId: match.id } });
    if (exists === 0) {
      await prisma.message.create({ data: { matchId: match.id, senderId: userA, text: 'Hey! How are you?' } });
      await prisma.message.create({ data: { matchId: match.id, senderId: userB, text: 'All good, want to meet this weekend?' } });
    }
  }

  // 2 pending selfies
  for (let i = 0; i < 2; i++) {
    const u = users[10 + i]!;
    await prisma.verification.upsert({
      where: { id: `v-pending-${u.id}` },
      update: {},
      create: { id: `v-pending-${u.id}`, userId: u.id, type: VerificationType.SELFIE, status: VerificationStatus.PENDING, path: `selfie/${u.id}/${randomUUID()}.jpg` },
    });
  }

  console.log('Seed complete:', { admin: admin.id, demo: demo.id, users: users.length });
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
EOF

# ----------------------------------------------------------------------------
# Validators (Zod)
# ----------------------------------------------------------------------------
cat > src/validators/auth.ts <<'EOF'
import { z } from 'zod';
export const sendOtpSchema = z.object({ phone: z.string().regex(/^\+\d{10,15}$/, 'Phone must be E.164') });
export const verifyOtpSchema = z.object({ phone: z.string().regex(/^\+\d{10,15}$/), otp: z.string().regex(/^\d{6}$/) });
EOF

cat > src/validators/me.ts <<'EOF'
import { z } from 'zod';

// why: accept both frontend kebab-case and backend enum form of mode.
const mode = z.union([z.enum(['HAS_FLAT', 'NEEDS_FLAT']), z.enum(['have-flat', 'need-flat'])])
  .transform((v) => (v === 'have-flat' ? 'HAS_FLAT' : v === 'need-flat' ? 'NEEDS_FLAT' : v));

export const profileSchema = z.object({
  name: z.string().min(2).max(80),
  gender: z.string().min(1),
  dob: z.string().datetime().or(z.string().min(4)),
  city: z.string().min(2).max(80),
  bio: z.string().max(400).default(''),
  budgetMin: z.number().int().positive(),
  budgetMax: z.number().int().positive(),
  moveInDate: z.string().min(4),
  occupation: z.string().min(1),
  mode: mode,
  photos: z.array(z.string()).max(6).default([]),
}).refine((d) => d.budgetMax >= d.budgetMin, { message: 'budgetMax must be >= budgetMin' });

export const lifestyleSchema = z.object({
  sleepTime: z.number().int().min(0).max(1440),
  wakeTime:  z.number().int().min(0).max(1440),
  cleanliness: z.number().int().min(1).max(5),
  smoking:  z.boolean(),
  drinking: z.boolean(),
  pets:     z.boolean(),
  diet:     z.string().min(1),
  guestsLevel: z.number().int().min(1).max(5),
  noiseLevel:  z.number().int().min(1).max(5),
  cooking:  z.string().min(1),
});

export const dealBreakersSchema = z.array(z.object({ key: z.string().min(1), value: z.string().min(1) })).max(20);

export const uploadUrlSchema = z.object({
  fileType: z.string().min(3),
  fileSize: z.number().int().positive().max(5 * 1024 * 1024),
  purpose: z.enum(['profile', 'selfie', 'listing']),
});
EOF

cat > src/validators/common.ts <<'EOF'
import { z } from 'zod';
export const cursorQuery = z.object({
  cursor: z.string().optional(),
  city: z.string().optional(),
  min: z.coerce.number().int().optional(),
  max: z.coerce.number().int().optional(),
  verified: z.coerce.boolean().optional(),
});
export const idParam = z.object({ id: z.string().min(1) });
EOF

cat > src/validators/swipes.ts <<'EOF'
import { z } from 'zod';
export const swipeSchema = z.object({
  toUserId: z.string().min(1),
  action: z.union([z.enum(['LIKE','PASS','SUPER']), z.enum(['like','pass','super'])]).transform((v) => v.toUpperCase() as 'LIKE'|'PASS'|'SUPER'),
});
EOF

cat > src/validators/messages.ts <<'EOF'
import { z } from 'zod';
export const sendMessageSchema = z.object({ text: z.string().min(1).max(1000) });
EOF

cat > src/validators/listings.ts <<'EOF'
import { z } from 'zod';
export const listingCreateSchema = z.object({
  title: z.string().min(2).max(120),
  city: z.string().min(2).max(80),
  locality: z.string().min(2).max(120),
  rent: z.number().int().positive(),
  deposit: z.number().int().nonnegative().default(0),
  bills: z.number().int().nonnegative().default(0),
  description: z.string().max(1000).default(''),
  photos: z.array(z.string()).max(10).default([]),
  amenities: z.array(z.string()).max(30).default([]),
  availableFrom: z.string().min(4),
});
export const listingUpdateSchema = listingCreateSchema.partial();
EOF

cat > src/validators/agreement.ts <<'EOF'
import { z } from 'zod';
export const agreementRulesSchema = z.object({
  rules: z.object({
    guests:     z.string().max(200).optional(),
    quietHours: z.string().max(200).optional(),
    dishes:     z.string().max(200).optional(),
    bills:      z.string().max(200).optional(),
    cleaning:   z.string().max(200).optional(),
    smoking:    z.string().max(200).optional(),
    pets:       z.string().max(200).optional(),
  }).passthrough(),
});
EOF

cat > src/validators/safety.ts <<'EOF'
import { z } from 'zod';
export const reportSchema = z.object({
  targetUserId: z.string().min(1),
  reason: z.string().min(2).max(200),
  details: z.string().max(1000).optional(),
});
export const blockSchema = z.object({ targetUserId: z.string().min(1) });
export const selfieSchema = z.object({ path: z.string().min(3) });
EOF

cat > src/validators/payments.ts <<'EOF'
import { z } from 'zod';
export const paymentOrderSchema = z.object({ plan: z.enum(['VERIFIED','BOOST']) });
EOF

cat > src/validators/admin.ts <<'EOF'
import { z } from 'zod';
export const verificationReviewSchema = z.object({ status: z.enum(['approved','rejected']) });
EOF

# ----------------------------------------------------------------------------
# Services
# ----------------------------------------------------------------------------
cat > src/services/otp.ts <<'EOF'
import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';
import { hash, verifyHash } from '../lib/hash.js';
import { logger } from '../lib/logger.js';
import { BadRequest, TooMany } from '../lib/errors.js';

const TTL_MS = 5 * 60_000;
const MAX_ATTEMPTS = 5;

function generate6(): string { return String(Math.floor(100000 + Math.random() * 900000)); }

// why: tiny interface lets us swap ConsoleProvider for real SMS later.
interface OtpProvider { send(phone: string, code: string): Promise<void>; }
const ConsoleProvider: OtpProvider = {
  async send(phone, code) {
    if (env.NODE_ENV !== 'production') logger.info({ phone, code }, 'DEV OTP');
  },
};
const provider: OtpProvider = ConsoleProvider;

export async function sendOtp(phone: string): Promise<{ resendInSeconds: number }> {
  const code = env.DEMO_MODE && phone === env.DEMO_PHONE ? env.DEMO_OTP : generate6();
  const codeHash = await hash(code);
  const expiresAt = new Date(Date.now() + TTL_MS);
  await prisma.otpCode.create({ data: { phone, codeHash, expiresAt } });
  await provider.send(phone, code);
  return { resendInSeconds: 30 };
}

export async function verifyOtp(phone: string, otp: string): Promise<boolean> {
  const row = await prisma.otpCode.findFirst({ where: { phone, usedAt: null }, orderBy: { createdAt: 'desc' } });
  if (!row) throw BadRequest('No OTP requested');
  if (row.expiresAt.getTime() < Date.now()) throw BadRequest('OTP expired');
  if (row.attempts >= MAX_ATTEMPTS) throw TooMany('OTP locked, request a new one');

  // Demo override: when DEMO_MODE and phone matches, DEMO_OTP always passes.
  if (env.DEMO_MODE && phone === env.DEMO_PHONE && otp === env.DEMO_OTP) {
    await prisma.otpCode.update({ where: { id: row.id }, data: { usedAt: new Date() } });
    return true;
  }
  const ok = await verifyHash(otp, row.codeHash);
  if (!ok) {
    await prisma.otpCode.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
    throw BadRequest('Invalid OTP');
  }
  await prisma.otpCode.update({ where: { id: row.id }, data: { usedAt: new Date() } });
  return true;
}
EOF

cat > src/services/auth.ts <<'EOF'
import { prisma } from '../lib/prisma.js';
import { hash, verifyHash } from '../lib/hash.js';
import { signAccess, signRefresh, verifyRefresh } from '../lib/jwt.js';
import { Unauthorized } from '../lib/errors.js';
import { randomUUID } from 'node:crypto';
import ms from './ms.js';
import { env } from '../config/env.js';

export async function issueTokens(userId: string, familyId?: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw Unauthorized('User missing');
  const jti = randomUUID();
  const family = familyId ?? randomUUID();
  const access = signAccess({ sub: user.id, role: user.role, plan: user.plan });
  const refresh = signRefresh({ sub: user.id, jti });
  const expiresAt = new Date(Date.now() + ms(env.REFRESH_TTL));
  await prisma.refreshToken.create({ data: { userId: user.id, tokenHash: await hash(refresh), familyId: family, expiresAt } });
  return { access, refresh, user, family };
}

export async function rotateRefresh(oldToken: string) {
  let payload;
  try { payload = verifyRefresh(oldToken); } catch { throw Unauthorized('Invalid refresh'); }
  const tokens = await prisma.refreshToken.findMany({ where: { userId: payload.sub, revokedAt: null } });
  let matched = null;
  for (const t of tokens) {
    if (await verifyHash(oldToken, t.tokenHash)) { matched = t; break; }
  }
  if (!matched) {
    // why: reuse detected - revoke the entire family to kick attackers out.
    await prisma.refreshToken.updateMany({ where: { userId: payload.sub }, data: { revokedAt: new Date() } });
    throw Unauthorized('Refresh reuse detected');
  }
  await prisma.refreshToken.update({ where: { id: matched.id }, data: { revokedAt: new Date() } });
  return issueTokens(payload.sub, matched.familyId);
}

export async function logoutByToken(oldToken: string) {
  try {
    const payload = verifyRefresh(oldToken);
    const tokens = await prisma.refreshToken.findMany({ where: { userId: payload.sub, revokedAt: null } });
    for (const t of tokens) {
      if (await verifyHash(oldToken, t.tokenHash)) {
        await prisma.refreshToken.update({ where: { id: t.id }, data: { revokedAt: new Date() } });
        break;
      }
    }
  } catch { /* silent */ }
}
EOF

cat > src/services/ms.ts <<'EOF'
// why: tiny parser avoids extra deps; accepts "15m", "7d", "30s", "1h".
export default function ms(input: string): number {
  const m = /^(\d+)\s*(ms|s|m|h|d)$/.exec(input.trim());
  if (!m) return Number(input) || 0;
  const n = Number(m[1]);
  const unit = m[2];
  const mult = unit === 'ms' ? 1 : unit === 's' ? 1000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000;
  return n * mult;
}
EOF

cat > src/services/matching.ts <<'EOF'
// why: pure functions so every factor is unit-testable without a DB.

export type Lifestyle = {
  sleepTime: number; wakeTime: number; cleanliness: number;
  smoking: boolean; drinking: boolean; pets: boolean;
  diet: string; guestsLevel: number; noiseLevel: number; cooking: string;
};

export type ProfileLite = { city: string; budgetMin: number; budgetMax: number };

export function circularMinutesDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 1440;
  return Math.min(d, 1440 - d);
}

export function sleepScore(a: Lifestyle, b: Lifestyle): number {
  const sleepDiffHr = circularMinutesDiff(a.sleepTime, b.sleepTime) / 60;
  const wakeDiffHr  = circularMinutesDiff(a.wakeTime,  b.wakeTime)  / 60;
  const avg = (sleepDiffHr + wakeDiffHr) / 2;
  return Math.max(0, 1 - Math.min(4, avg) / 4);
}
export function cleanlinessScore(a: Lifestyle, b: Lifestyle): number {
  return 1 - Math.abs(a.cleanliness - b.cleanliness) / 4;
}
export function smokingDrinkingScore(a: Lifestyle, b: Lifestyle): number {
  const sEq = a.smoking === b.smoking;
  const dEq = a.drinking === b.drinking;
  if (sEq && dEq) return 1;
  if (sEq || dEq) return 0.4;
  return 0;
}
export function guestsNoiseScore(a: Lifestyle, b: Lifestyle): number {
  const avg = (Math.abs(a.guestsLevel - b.guestsLevel) + Math.abs(a.noiseLevel - b.noiseLevel)) / 2;
  return 1 - avg / 4;
}
export function budgetScore(a: ProfileLite, b: ProfileLite): number {
  const lo = Math.max(a.budgetMin, b.budgetMin);
  const hi = Math.min(a.budgetMax, b.budgetMax);
  if (hi < lo) return 0;
  const overlap = hi - lo;
  const union = Math.max(a.budgetMax, b.budgetMax) - Math.min(a.budgetMin, b.budgetMin);
  return union === 0 ? 1 : overlap / union;
}
export function petsDietCookingScore(a: Lifestyle, b: Lifestyle): number {
  const matches = [a.pets === b.pets, a.diet === b.diet, a.cooking === b.cooking].filter(Boolean).length;
  return matches / 3;
}

export const WEIGHTS = { sleep: 25, cleanliness: 20, smokingDrinking: 15, guestsNoise: 15, budget: 15, petsDietCooking: 10 } as const;

export function computeScore(a: Lifestyle & ProfileLite, b: Lifestyle & ProfileLite): { score: number; breakdown: { label: string; weight: number; score: number }[] } {
  const bd = [
    { label: 'Sleep schedule',          weight: WEIGHTS.sleep,           score: sleepScore(a, b) },
    { label: 'Cleanliness',             weight: WEIGHTS.cleanliness,     score: cleanlinessScore(a, b) },
    { label: 'Smoking and drinking',    weight: WEIGHTS.smokingDrinking, score: smokingDrinkingScore(a, b) },
    { label: 'Guests and noise',        weight: WEIGHTS.guestsNoise,     score: guestsNoiseScore(a, b) },
    { label: 'Budget overlap',          weight: WEIGHTS.budget,          score: budgetScore(a, b) },
    { label: 'Pets, diet, cooking',     weight: WEIGHTS.petsDietCooking, score: petsDietCookingScore(a, b) },
  ];
  const score = Math.round(bd.reduce((s, x) => s + x.weight * x.score, 0));
  return { score, breakdown: bd };
}

export function hardFilterOk(a: { city: string; budgetMin: number; budgetMax: number }, b: { city: string; budgetMin: number; budgetMax: number }): boolean {
  if (a.city.toLowerCase() !== b.city.toLowerCase()) return false;
  if (b.budgetMax < a.budgetMin || b.budgetMin > a.budgetMax) return false;
  return true;
}

export function reasons(bd: { label: string; weight: number; score: number }[]): { top: string[]; good: string[]; bad: string[] } {
  const ranked = [...bd].sort((x, y) => y.score - x.score);
  const good = ranked.filter((x) => x.score >= 0.7).map((x) => `${x.label} fits well`);
  const bad  = ranked.filter((x) => x.score < 0.4).map((x) => `${x.label} differs`);
  const top  = ranked.slice(0, 3).map((x) => `${x.label} looks compatible`);
  return { top, good, bad };
}
EOF

# ----------------------------------------------------------------------------
# Repositories
# ----------------------------------------------------------------------------
cat > src/repositories/discover.ts <<'EOF'
import { prisma } from '../lib/prisma.js';

// why: a single query grabs every piece the matching engine needs.
export async function loadCandidatePool(userId: string, city?: string) {
  const [me, blocks, blockedBy, swipes] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, include: { profile: true, lifestyle: true, dealBreakers: true } }),
    prisma.block.findMany({ where: { blockerId: userId }, select: { blockedId: true } }),
    prisma.block.findMany({ where: { blockedId: userId }, select: { blockerId: true } }),
    prisma.swipe.findMany({ where: { fromUser: userId }, select: { toUser: true } }),
  ]);
  if (!me || !me.profile || !me.lifestyle) return { me: null, candidates: [] as any[] };

  const excluded = new Set<string>([userId, ...blocks.map((b) => b.blockedId), ...blockedBy.map((b) => b.blockerId), ...swipes.map((s) => s.toUser)]);

  const candidates = await prisma.user.findMany({
    where: {
      id: { notIn: Array.from(excluded) },
      profile: { city: city ?? me.profile.city },
    },
    include: { profile: true, lifestyle: true, dealBreakers: true },
    take: 200,
  });

  return { me, candidates };
}
EOF

cat > src/repositories/user.ts <<'EOF'
import { prisma } from '../lib/prisma.js';

export function getUserFull(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    include: { profile: true, lifestyle: true, dealBreakers: true, verifications: true },
  });
}
EOF

# ----------------------------------------------------------------------------
# Controllers + Routes
# ----------------------------------------------------------------------------
cat > src/controllers/auth.ts <<'EOF'
import type { Request, Response, NextFunction } from 'express';
import { sendOtp, verifyOtp } from '../services/otp.js';
import { issueTokens, rotateRefresh, logoutByToken } from '../services/auth.js';
import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';
import ms from '../services/ms.js';
import { Unauthorized } from '../lib/errors.js';

const cookieOpts = () => ({
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/auth',
  maxAge: ms(env.REFRESH_TTL),
});

export async function postSendOtp(req: Request, res: Response, next: NextFunction) {
  try {
    const { phone } = req.body as { phone: string };
    const r = await sendOtp(phone);
    res.json({ ok: true, ...r });
  } catch (e) { next(e); }
}

export async function postVerifyOtp(req: Request, res: Response, next: NextFunction) {
  try {
    const { phone, otp } = req.body as { phone: string; otp: string };
    await verifyOtp(phone, otp);
    let user = await prisma.user.findUnique({ where: { phone } });
    let isNewUser = false;
    if (!user) {
      isNewUser = true;
      user = await prisma.user.create({ data: { phone, name: 'New user', gender: 'unspecified', dob: new Date('2000-01-01') } });
    }
    const { access, refresh } = await issueTokens(user.id);
    res.cookie('rt', refresh, cookieOpts());
    res.json({ accessToken: access, user: { id: user.id, name: user.name, role: user.role, plan: user.plan }, isNewUser });
  } catch (e) { next(e); }
}

export async function postRefresh(req: Request, res: Response, next: NextFunction) {
  try {
    const rt = req.cookies?.rt;
    if (!rt) throw Unauthorized('Missing refresh cookie');
    const { access, refresh, user } = await rotateRefresh(rt);
    res.cookie('rt', refresh, cookieOpts());
    res.json({ accessToken: access, user: { id: user.id, name: user.name, role: user.role, plan: user.plan } });
  } catch (e) { next(e); }
}

export async function postLogout(req: Request, res: Response, next: NextFunction) {
  try {
    const rt = req.cookies?.rt;
    if (rt) await logoutByToken(rt);
    res.clearCookie('rt', { path: '/auth' });
    res.status(204).send();
  } catch (e) { next(e); }
}
EOF

cat > src/routes/auth.ts <<'EOF'
import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { sendOtpSchema, verifyOtpSchema } from '../validators/auth.js';
import { sendOtpLimiter, verifyOtpLimiter } from '../middleware/rateLimiters.js';
import { postSendOtp, postVerifyOtp, postRefresh, postLogout } from '../controllers/auth.js';

export const authRouter = Router();
authRouter.post('/send-otp', sendOtpLimiter, validate(sendOtpSchema), postSendOtp);
authRouter.post('/verify-otp', verifyOtpLimiter, validate(verifyOtpSchema), postVerifyOtp);
authRouter.post('/refresh', postRefresh);
authRouter.post('/logout', postLogout);
EOF

cat > src/controllers/me.ts <<'EOF'
import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma.js';
import { getUserFull } from '../repositories/user.js';
import { stripHtml } from '../lib/sanitize.js';
import { supabase, ALLOWED_MIME, MAX_UPLOAD_BYTES } from '../lib/supabase.js';
import { env } from '../config/env.js';
import { randomUUID } from 'node:crypto';
import { BadRequest } from '../lib/errors.js';

export async function getMe(req: Request, res: Response, next: NextFunction) {
  try {
    const u = (req as any).user;
    const full = await getUserFull(u.id);
    if (!full) throw BadRequest('User missing');
    const v = (type: string) => full.verifications.find((x) => x.type === type)?.status ?? 'NONE';
    res.json({
      user: { id: full.id, name: full.name, phone: full.phone, email: full.email, role: full.role, plan: full.plan, gender: full.gender, dob: full.dob },
      profile: full.profile ?? null,
      lifestyle: full.lifestyle ?? null,
      dealBreakers: full.dealBreakers.map(({ key, value }) => ({ key, value })),
      verification: { phone: v('PHONE'), email: v('EMAIL'), selfie: v('SELFIE') },
      plan: full.plan,
    });
  } catch (e) { next(e); }
}

export async function putProfile(req: Request, res: Response, next: NextFunction) {
  try {
    const u = (req as any).user;
    const body = req.body as any;
    // Ownership check on every photo path.
    for (const p of body.photos ?? []) {
      if (!String(p).includes(`/${u.id}/`)) throw BadRequest('Photo path must be in your folder');
    }
    const data = {
      bio: stripHtml(body.bio ?? ''),
      city: body.city, budgetMin: body.budgetMin, budgetMax: body.budgetMax,
      moveInDate: new Date(body.moveInDate),
      occupation: body.occupation, mode: body.mode, photos: body.photos ?? [],
    };
    await prisma.user.update({ where: { id: u.id }, data: { name: body.name, gender: body.gender, dob: new Date(body.dob) } });
    await prisma.profile.upsert({ where: { userId: u.id }, update: data, create: { userId: u.id, ...data } });
    res.json({ ok: true });
  } catch (e) { next(e); }
}

export async function putLifestyle(req: Request, res: Response, next: NextFunction) {
  try {
    const u = (req as any).user;
    const data = req.body;
    await prisma.lifestyle.upsert({ where: { userId: u.id }, update: data, create: { userId: u.id, ...data } });
    res.json({ ok: true });
  } catch (e) { next(e); }
}

export async function putDealBreakers(req: Request, res: Response, next: NextFunction) {
  try {
    const u = (req as any).user;
    const list = req.body as { key: string; value: string }[];
    await prisma.$transaction([
      prisma.dealBreaker.deleteMany({ where: { userId: u.id } }),
      prisma.dealBreaker.createMany({ data: list.map((d) => ({ userId: u.id, key: d.key, value: d.value })) }),
    ]);
    res.json({ ok: true });
  } catch (e) { next(e); }
}

export async function postUploadUrl(req: Request, res: Response, next: NextFunction) {
  try {
    const u = (req as any).user;
    const { fileType, fileSize, purpose } = req.body as { fileType: string; fileSize: number; purpose: 'profile'|'selfie'|'listing' };
    if (!ALLOWED_MIME.includes(fileType)) throw BadRequest('Unsupported file type');
    if (fileSize > MAX_UPLOAD_BYTES) throw BadRequest('File too large');
    const ext = fileType.split('/')[1] ?? 'bin';
    const bucket = purpose === 'selfie' ? env.SUPABASE_PRIVATE_BUCKET : env.SUPABASE_BUCKET;
    const path = `${purpose}/${u.id}/${randomUUID()}.${ext}`;
    const { data, error } = await supabase().storage.from(bucket).createSignedUploadUrl(path);
    if (error || !data) throw BadRequest('Failed to create upload url');
    const publicUrl = purpose === 'selfie' ? '' : supabase().storage.from(bucket).getPublicUrl(path).data.publicUrl;
    res.json({ uploadUrl: data.signedUrl, path, publicUrl });
  } catch (e) { next(e); }
}
EOF

cat > src/routes/me.ts <<'EOF'
import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { validate } from '../middleware/validate.js';
import { profileSchema, lifestyleSchema, dealBreakersSchema, uploadUrlSchema } from '../validators/me.js';
import { getMe, putProfile, putLifestyle, putDealBreakers, postUploadUrl } from '../controllers/me.js';

export const meRouter = Router();
meRouter.use(requireAuth);
meRouter.get('/', getMe);
meRouter.put('/profile', validate(profileSchema), putProfile);
meRouter.put('/lifestyle', validate(lifestyleSchema), putLifestyle);
meRouter.put('/deal-breakers', validate(dealBreakersSchema), putDealBreakers);
meRouter.post('/photos/upload-url', validate(uploadUrlSchema), postUploadUrl);
EOF

cat > src/controllers/discover.ts <<'EOF'
import type { Request, Response, NextFunction } from 'express';
import { loadCandidatePool } from '../repositories/discover.js';
import { computeScore, hardFilterOk, reasons } from '../services/matching.js';
import { cache, cacheKey } from '../lib/cache.js';

export async function getDiscover(req: Request, res: Response, next: NextFunction) {
  try {
    const u = (req as any).user;
    const city = (req.query.city as string | undefined) ?? undefined;
    const cursor = req.query.cursor as string | undefined;
    const key = cacheKey('discover', u.id, city ?? '', cursor ?? '');

    let cached = cache.get<any[]>(key);
    if (!cached) {
      const { me, candidates } = await loadCandidatePool(u.id, city);
      if (!me) { res.json({ items: [], nextCursor: null }); return; }
      const items = candidates
        .filter((c) => c.profile && c.lifestyle)
        .map((c) => {
          if (!hardFilterOk({ city: me.profile!.city, budgetMin: me.profile!.budgetMin, budgetMax: me.profile!.budgetMax }, { city: c.profile!.city, budgetMin: c.profile!.budgetMin, budgetMax: c.profile!.budgetMax })) return null;
          const a = { ...me.lifestyle!, city: me.profile!.city, budgetMin: me.profile!.budgetMin, budgetMax: me.profile!.budgetMax };
          const b = { ...c.lifestyle!,  city: c.profile!.city,  budgetMin: c.profile!.budgetMin,  budgetMax: c.profile!.budgetMax };
          const { score, breakdown } = computeScore(a as any, b as any);
          const r = reasons(breakdown);
          const age = c.dob ? Math.floor((Date.now() - new Date(c.dob).getTime()) / (365.25 * 86400000)) : null;
          return {
            userId: c.id, name: c.name, age, city: c.profile!.city,
            photos: c.profile!.photos, score, topReasons: r.top,
            lifestyleChips: [
              { label: 'Cleanliness', same: a.cleanliness === b.cleanliness },
              { label: 'Smoking', same: a.smoking === b.smoking },
              { label: 'Diet', same: a.diet === b.diet },
            ],
            budgetMin: c.profile!.budgetMin, budgetMax: c.profile!.budgetMax,
          };
        })
        .filter(Boolean) as any[];
      items.sort((x, y) => (y.score - x.score) || x.userId.localeCompare(y.userId));
      cached = items;
      cache.set(key, items);
    }

    const pageSize = 20;
    const startIdx = cursor ? cached.findIndex((x) => x.userId === cursor) + 1 : 0;
    const page = cached.slice(startIdx, startIdx + pageSize);
    const nextCursor = startIdx + pageSize < cached.length ? page[page.length - 1]?.userId : null;
    res.json({ items: page, nextCursor });
  } catch (e) { next(e); }
}
EOF

cat > src/routes/discover.ts <<'EOF'
import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { getDiscover } from '../controllers/discover.js';

export const discoverRouter = Router();
discoverRouter.use(requireAuth);
discoverRouter.get('/', getDiscover);
EOF

cat > src/controllers/swipes.ts <<'EOF'
import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma.js';
import { cache } from '../lib/cache.js';
import { computeScore } from '../services/matching.js';
import { emitMatchEvent } from '../sockets/index.js';

export async function postSwipe(req: Request, res: Response, next: NextFunction) {
  try {
    const u = (req as any).user;
    const { toUserId, action } = req.body as { toUserId: string; action: 'LIKE'|'PASS'|'SUPER' };

    // why: wrap swipe + match creation in a tx so we never produce a half match.
    const result = await prisma.$transaction(async (tx) => {
      await tx.swipe.upsert({
        where: { fromUser_toUser: { fromUser: u.id, toUser: toUserId } },
        update: { action },
        create: { fromUser: u.id, toUser: toUserId, action },
      });
      let matched = false, matchId: string | null = null;
      if (action !== 'PASS') {
        const other = await tx.swipe.findUnique({ where: { fromUser_toUser: { fromUser: toUserId, toUser: u.id } } });
        if (other && other.action !== 'PASS') {
          const [userA, userB] = u.id < toUserId ? [u.id, toUserId] : [toUserId, u.id];
          const me = await tx.user.findUnique({ where: { id: u.id }, include: { profile: true, lifestyle: true } });
          const them = await tx.user.findUnique({ where: { id: toUserId }, include: { profile: true, lifestyle: true } });
          let score = 70;
          if (me?.profile && me.lifestyle && them?.profile && them.lifestyle) {
            score = computeScore(
              { ...me.lifestyle, city: me.profile.city, budgetMin: me.profile.budgetMin, budgetMax: me.profile.budgetMax } as any,
              { ...them.lifestyle, city: them.profile.city, budgetMin: them.profile.budgetMin, budgetMax: them.profile.budgetMax } as any,
            ).score;
          }
          const match = await tx.match.upsert({
            where: { userA_userB: { userA, userB } },
            update: {},
            create: { userA, userB, score },
          });
          matched = true; matchId = match.id;
        }
      }
      return { matched, matchId };
    });

    // Invalidate discover cache for this user.
    for (const k of cache.keys()) if (k.startsWith(`discover:${u.id}:`)) cache.del(k);

    if (result.matched && result.matchId) emitMatchEvent(u.id, toUserId, result.matchId);
    res.json(result);
  } catch (e) { next(e); }
}
EOF

cat > src/routes/swipes.ts <<'EOF'
import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { validate } from '../middleware/validate.js';
import { swipeSchema } from '../validators/swipes.js';
import { postSwipe } from '../controllers/swipes.js';

export const swipesRouter = Router();
swipesRouter.use(requireAuth);
swipesRouter.post('/', validate(swipeSchema), postSwipe);
EOF

cat > src/controllers/matches.ts <<'EOF'
import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma.js';
import { computeScore, reasons } from '../services/matching.js';
import { stripHtml } from '../lib/sanitize.js';
import { NotFound } from '../lib/errors.js';
import { emitMessage } from '../sockets/index.js';

async function assertMember(matchId: string, userId: string) {
  const m = await prisma.match.findUnique({ where: { id: matchId } });
  if (!m || (m.userA !== userId && m.userB !== userId)) throw NotFound('Match not found');
  return m;
}

export async function listMatches(req: Request, res: Response, next: NextFunction) {
  try {
    const u = (req as any).user;
    const matches = await prisma.match.findMany({
      where: { OR: [{ userA: u.id }, { userB: u.id }] },
      orderBy: { createdAt: 'desc' },
      include: { messages: { orderBy: { createdAt: 'desc' }, take: 1 } },
      take: 50,
    });
    const items = await Promise.all(matches.map(async (m) => {
      const otherId = m.userA === u.id ? m.userB : m.userA;
      const other = await prisma.user.findUnique({ where: { id: otherId }, include: { profile: true } });
      const unread = await prisma.message.count({ where: { matchId: m.id, senderId: otherId, readAt: null } });
      return {
        matchId: m.id,
        otherUser: {
          id: other?.id, name: other?.name, age: other?.dob ? Math.floor((Date.now() - new Date(other.dob).getTime()) / (365.25*86400000)) : null,
          city: other?.profile?.city, occupation: other?.profile?.occupation, avatar: other?.profile?.photos?.[0] ?? null,
        },
        score: m.score,
        lastMessage: m.messages[0] ?? null,
        unreadCount: unread,
      };
    }));
    res.json({ items, nextCursor: null });
  } catch (e) { next(e); }
}

export async function getCompatibility(req: Request, res: Response, next: NextFunction) {
  try {
    const u = (req as any).user;
    const match = await assertMember(req.params.id!, u.id);
    const [a, b] = await Promise.all([
      prisma.user.findUnique({ where: { id: match.userA }, include: { profile: true, lifestyle: true } }),
      prisma.user.findUnique({ where: { id: match.userB }, include: { profile: true, lifestyle: true } }),
    ]);
    if (!a?.profile || !a.lifestyle || !b?.profile || !b.lifestyle) throw NotFound('Profiles incomplete');
    const x = { ...a.lifestyle, city: a.profile.city, budgetMin: a.profile.budgetMin, budgetMax: a.profile.budgetMax };
    const y = { ...b.lifestyle, city: b.profile.city, budgetMin: b.profile.budgetMin, budgetMax: b.profile.budgetMax };
    const { score, breakdown } = computeScore(x as any, y as any);
    const r = reasons(breakdown);
    res.json({ score, breakdown, reasons: { good: r.good, bad: r.bad } });
  } catch (e) { next(e); }
}

export async function listMessages(req: Request, res: Response, next: NextFunction) {
  try {
    const u = (req as any).user;
    await assertMember(req.params.id!, u.id);
    const cursor = req.query.cursor as string | undefined;
    const items = await prisma.message.findMany({
      where: { matchId: req.params.id! },
      orderBy: { createdAt: 'desc' },
      take: 20,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    const nextCursor = items.length === 20 ? items[items.length - 1]?.id : null;
    res.json({ items: items.reverse(), nextCursor });
  } catch (e) { next(e); }
}

export async function postMessage(req: Request, res: Response, next: NextFunction) {
  try {
    const u = (req as any).user;
    const match = await assertMember(req.params.id!, u.id);
    const text = stripHtml(String((req.body as any).text)).slice(0, 1000);
    const msg = await prisma.message.create({ data: { matchId: match.id, senderId: u.id, text } });
    const otherId = match.userA === u.id ? match.userB : match.userA;
    emitMessage(otherId, msg);
    res.json(msg);
  } catch (e) { next(e); }
}
EOF

cat > src/routes/matches.ts <<'EOF'
import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { validate } from '../middleware/validate.js';
import { sendMessageSchema } from '../validators/messages.js';
import { messageLimiter } from '../middleware/rateLimiters.js';
import { listMatches, getCompatibility, listMessages, postMessage } from '../controllers/matches.js';

export const matchesRouter = Router();
matchesRouter.use(requireAuth);
matchesRouter.get('/', listMatches);
matchesRouter.get('/:id/compatibility', getCompatibility);
matchesRouter.get('/:id/messages', listMessages);
matchesRouter.post('/:id/messages', messageLimiter, validate(sendMessageSchema), postMessage);
EOF

cat > src/controllers/agreement.ts <<'EOF'
import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma.js';
import { NotFound } from '../lib/errors.js';

async function assertMember(matchId: string, userId: string) {
  const m = await prisma.match.findUnique({ where: { id: matchId } });
  if (!m || (m.userA !== userId && m.userB !== userId)) throw NotFound('Match not found');
  return m;
}

export async function getAgreement(req: Request, res: Response, next: NextFunction) {
  try {
    const u = (req as any).user;
    const match = await assertMember(req.params.id!, u.id);
    const a = await prisma.agreement.findUnique({ where: { matchId: match.id } });
    res.json(a ?? null);
  } catch (e) { next(e); }
}

export async function upsertAgreement(req: Request, res: Response, next: NextFunction) {
  try {
    const u = (req as any).user;
    const match = await assertMember(req.params.id!, u.id);
    const { rules } = req.body as any;
    const a = await prisma.agreement.upsert({
      where: { matchId: match.id },
      update: { rules, acceptedByA: false, acceptedByB: false }, // why: edits reset acceptance so nobody is bound to new rules silently.
      create: { matchId: match.id, rules },
    });
    res.json(a);
  } catch (e) { next(e); }
}

export async function acceptAgreement(req: Request, res: Response, next: NextFunction) {
  try {
    const u = (req as any).user;
    const a = await prisma.agreement.findUnique({ where: { id: req.params.id! }, include: { match: true } });
    if (!a) throw NotFound('Agreement not found');
    const match = a.match;
    if (match.userA !== u.id && match.userB !== u.id) throw NotFound('Agreement not found');
    const patch: any = match.userA === u.id ? { acceptedByA: true } : { acceptedByB: true };
    const out = await prisma.agreement.update({ where: { id: a.id }, data: patch });
    res.json(out);
  } catch (e) { next(e); }
}
EOF

cat > src/routes/agreement.ts <<'EOF'
import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { validate } from '../middleware/validate.js';
import { agreementRulesSchema } from '../validators/agreement.js';
import { getAgreement, upsertAgreement, acceptAgreement } from '../controllers/agreement.js';

export const agreementRouter = Router();
agreementRouter.use(requireAuth);
agreementRouter.get('/matches/:id/agreement', getAgreement);
agreementRouter.post('/matches/:id/agreement', validate(agreementRulesSchema), upsertAgreement);
agreementRouter.put('/agreements/:id/accept', acceptAgreement);
EOF

cat > src/controllers/listings.ts <<'EOF'
import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma.js';
import { stripHtml } from '../lib/sanitize.js';
import { NotFound, Forbidden } from '../lib/errors.js';

export async function listListings(req: Request, res: Response, next: NextFunction) {
  try {
    const { city, min, max, verified, cursor } = req.query as any;
    const where: any = {};
    if (city) where.city = city;
    if (min || max) where.rent = { ...(min ? { gte: Number(min) } : {}), ...(max ? { lte: Number(max) } : {}) };
    if (verified !== undefined) where.verified = verified === 'true' || verified === true;
    const items = await prisma.listing.findMany({
      where, orderBy: { createdAt: 'desc' }, take: 20,
      ...(cursor ? { skip: 1, cursor: { id: String(cursor) } } : {}),
    });
    const nextCursor = items.length === 20 ? items[items.length - 1]?.id : null;
    res.json({ items, nextCursor });
  } catch (e) { next(e); }
}

export async function getListing(req: Request, res: Response, next: NextFunction) {
  try {
    const row = await prisma.listing.findUnique({ where: { id: req.params.id! } });
    if (!row) throw NotFound('Listing not found');
    res.json(row);
  } catch (e) { next(e); }
}

export async function createListing(req: Request, res: Response, next: NextFunction) {
  try {
    const u = (req as any).user;
    const body = req.body as any;
    const row = await prisma.listing.create({
      data: {
        ownerId: u.id,
        title: stripHtml(body.title),
        city: body.city,
        locality: body.locality,
        rent: body.rent,
        deposit: body.deposit ?? 0,
        bills: body.bills ?? 0,
        description: stripHtml(body.description ?? ''),
        photos: body.photos ?? [],
        amenities: body.amenities ?? [],
        availableFrom: new Date(body.availableFrom),
      },
    });
    res.json(row);
  } catch (e) { next(e); }
}

export async function updateListing(req: Request, res: Response, next: NextFunction) {
  try {
    const u = (req as any).user;
    const row = await prisma.listing.findUnique({ where: { id: req.params.id! } });
    if (!row) throw NotFound('Listing not found');
    if (row.ownerId !== u.id) throw Forbidden('Not your listing');
    const body = req.body as any;
    const updated = await prisma.listing.update({
      where: { id: row.id },
      data: {
        ...(body.title !== undefined ? { title: stripHtml(body.title) } : {}),
        ...(body.city !== undefined ? { city: body.city } : {}),
        ...(body.locality !== undefined ? { locality: body.locality } : {}),
        ...(body.rent !== undefined ? { rent: body.rent } : {}),
        ...(body.deposit !== undefined ? { deposit: body.deposit } : {}),
        ...(body.bills !== undefined ? { bills: body.bills } : {}),
        ...(body.description !== undefined ? { description: stripHtml(body.description) } : {}),
        ...(body.photos !== undefined ? { photos: body.photos } : {}),
        ...(body.amenities !== undefined ? { amenities: body.amenities } : {}),
        ...(body.availableFrom !== undefined ? { availableFrom: new Date(body.availableFrom) } : {}),
      },
    });
    res.json(updated);
  } catch (e) { next(e); }
}

export async function deleteListing(req: Request, res: Response, next: NextFunction) {
  try {
    const u = (req as any).user;
    const row = await prisma.listing.findUnique({ where: { id: req.params.id! } });
    if (!row) throw NotFound('Listing not found');
    if (row.ownerId !== u.id) throw Forbidden('Not your listing');
    await prisma.listing.delete({ where: { id: row.id } });
    res.status(204).send();
  } catch (e) { next(e); }
}
EOF

cat > src/routes/listings.ts <<'EOF'
import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { validate } from '../middleware/validate.js';
import { listingCreateSchema, listingUpdateSchema } from '../validators/listings.js';
import { listListings, getListing, createListing, updateListing, deleteListing } from '../controllers/listings.js';

export const listingsRouter = Router();
listingsRouter.get('/', listListings);                // why: listings browsing is public for discovery.
listingsRouter.get('/:id', getListing);
listingsRouter.post('/', requireAuth, validate(listingCreateSchema), createListing);
listingsRouter.put('/:id', requireAuth, validate(listingUpdateSchema), updateListing);
listingsRouter.delete('/:id', requireAuth, deleteListing);
EOF

cat > src/controllers/safety.ts <<'EOF'
import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma.js';
import { stripHtml } from '../lib/sanitize.js';

export async function postReport(req: Request, res: Response, next: NextFunction) {
  try {
    const u = (req as any).user;
    const { targetUserId, reason, details } = req.body as any;
    const row = await prisma.report.create({ data: { reporterId: u.id, targetId: targetUserId, reason, details: stripHtml(details ?? '') } });
    res.json(row);
  } catch (e) { next(e); }
}

export async function listBlocks(req: Request, res: Response, next: NextFunction) {
  try {
    const u = (req as any).user;
    const items = await prisma.block.findMany({ where: { blockerId: u.id } });
    res.json({ items });
  } catch (e) { next(e); }
}

export async function postBlock(req: Request, res: Response, next: NextFunction) {
  try {
    const u = (req as any).user;
    const { targetUserId } = req.body as any;
    const row = await prisma.block.upsert({
      where: { blockerId_blockedId: { blockerId: u.id, blockedId: targetUserId } },
      update: {}, create: { blockerId: u.id, blockedId: targetUserId },
    });
    res.json(row);
  } catch (e) { next(e); }
}

export async function deleteBlock(req: Request, res: Response, next: NextFunction) {
  try {
    const u = (req as any).user;
    await prisma.block.deleteMany({ where: { blockerId: u.id, blockedId: req.params.userId! } });
    res.status(204).send();
  } catch (e) { next(e); }
}

export async function postSelfie(req: Request, res: Response, next: NextFunction) {
  try {
    const u = (req as any).user;
    const { path } = req.body as { path: string };
    const row = await prisma.verification.create({ data: { userId: u.id, type: 'SELFIE', status: 'PENDING', path } });
    res.json({ status: row.status });
  } catch (e) { next(e); }
}
EOF

cat > src/routes/safety.ts <<'EOF'
import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { validate } from '../middleware/validate.js';
import { reportSchema, blockSchema, selfieSchema } from '../validators/safety.js';
import { postReport, listBlocks, postBlock, deleteBlock, postSelfie } from '../controllers/safety.js';

export const safetyRouter = Router();
safetyRouter.use(requireAuth);
safetyRouter.post('/reports', validate(reportSchema), postReport);
safetyRouter.get('/blocks', listBlocks);
safetyRouter.post('/blocks', validate(blockSchema), postBlock);
safetyRouter.delete('/blocks/:userId', deleteBlock);
safetyRouter.post('/verify/selfie', validate(selfieSchema), postSelfie);
EOF

cat > src/controllers/admin.ts <<'EOF'
import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma.js';
import { supabase } from '../lib/supabase.js';
import { env } from '../config/env.js';
import { NotFound } from '../lib/errors.js';

export async function listPendingVerifications(req: Request, res: Response, next: NextFunction) {
  try {
    const cursor = req.query.cursor as string | undefined;
    const items = await prisma.verification.findMany({
      where: { type: 'SELFIE', status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
      take: 20,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    const withUrls = await Promise.all(items.map(async (v) => {
      let signed: string | null = null;
      if (v.path) {
        try {
          const { data } = await supabase().storage.from(env.SUPABASE_PRIVATE_BUCKET).createSignedUrl(v.path, 60);
          signed = data?.signedUrl ?? null;
        } catch { signed = null; }
      }
      return { id: v.id, userId: v.userId, status: v.status, signedUrl: signed };
    }));
    const nextCursor = items.length === 20 ? items[items.length - 1]?.id : null;
    res.json({ items: withUrls, nextCursor });
  } catch (e) { next(e); }
}

export async function reviewVerification(req: Request, res: Response, next: NextFunction) {
  try {
    const u = (req as any).user;
    const { status } = req.body as { status: 'approved' | 'rejected' };
    const v = await prisma.verification.findUnique({ where: { id: req.params.id! } });
    if (!v) throw NotFound('Verification not found');
    const updated = await prisma.verification.update({
      where: { id: v.id },
      data: { status: status === 'approved' ? 'VERIFIED' : 'REJECTED', reviewedBy: u.id },
    });
    res.json(updated);
  } catch (e) { next(e); }
}
EOF

cat > src/routes/admin.ts <<'EOF'
import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireRole } from '../middleware/requireRole.js';
import { validate } from '../middleware/validate.js';
import { verificationReviewSchema } from '../validators/admin.js';
import { listPendingVerifications, reviewVerification } from '../controllers/admin.js';

export const adminRouter = Router();
adminRouter.use(requireAuth);
adminRouter.use(requireRole('ADMIN'));
adminRouter.get('/verifications', listPendingVerifications);
adminRouter.put('/verifications/:id', validate(verificationReviewSchema), reviewVerification);
EOF

cat > src/services/payments.ts <<'EOF'
import { env } from '../config/env.js';
import crypto from 'node:crypto';

export const PLAN_PRICES = { VERIFIED: 19900, BOOST: 29900 } as const;

export function isMockMode(): boolean {
  return !env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET;
}

let rzp: any = null;
export async function getRazorpay() {
  if (isMockMode()) return null;
  if (!rzp) {
    const mod = await import('razorpay');
    const Razorpay = (mod as any).default ?? mod;
    rzp = new Razorpay({ key_id: env.RAZORPAY_KEY_ID!, key_secret: env.RAZORPAY_KEY_SECRET! });
  }
  return rzp;
}

export function verifyWebhookSignature(rawBody: Buffer | string, signature: string): boolean {
  if (!env.RAZORPAY_WEBHOOK_SECRET) return false;
  const expected = crypto.createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET).update(rawBody as any).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
EOF

cat > src/controllers/payments.ts <<'EOF'
import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';
import { BadRequest, Forbidden } from '../lib/errors.js';
import { PLAN_PRICES, isMockMode, getRazorpay, verifyWebhookSignature } from '../services/payments.js';
import { randomUUID } from 'node:crypto';

export async function createOrder(req: Request, res: Response, next: NextFunction) {
  try {
    const u = (req as any).user;
    const { plan } = req.body as { plan: 'VERIFIED' | 'BOOST' };
    const amount = PLAN_PRICES[plan];

    if (isMockMode()) {
      const orderId = `mock_${randomUUID()}`;
      await prisma.payment.create({ data: { userId: u.id, plan, amount, razorpayOrderId: orderId } });
      res.json({ orderId, amount, keyId: 'mock', mock: true });
      return;
    }

    const r = await getRazorpay();
    const order = await r.orders.create({ amount, currency: 'INR', notes: { userId: u.id, plan } });
    await prisma.payment.create({ data: { userId: u.id, plan, amount, razorpayOrderId: order.id } });
    res.json({ orderId: order.id, amount, keyId: env.RAZORPAY_KEY_ID });
  } catch (e) { next(e); }
}

export async function webhook(req: Request, res: Response, next: NextFunction) {
  try {
    const sig = req.headers['x-razorpay-signature'] as string | undefined;
    if (!sig) throw BadRequest('Missing signature');
    const raw = (req as any).rawBody ?? Buffer.alloc(0);
    if (!verifyWebhookSignature(raw, sig)) throw BadRequest('Bad signature');
    const body = JSON.parse(raw.toString('utf8'));
    if (body.event === 'payment.captured') {
      const payment = body.payload.payment.entity;
      const orderId = payment.order_id;
      const row = await prisma.payment.findUnique({ where: { razorpayOrderId: orderId } });
      if (row && row.status !== 'PAID') {
        await prisma.$transaction([
          prisma.payment.update({ where: { id: row.id }, data: { status: 'PAID', razorpayPaymentId: payment.id } }),
          prisma.user.update({ where: { id: row.userId }, data: { plan: row.plan } }),
        ]);
      }
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
}

export async function mockConfirm(req: Request, res: Response, next: NextFunction) {
  try {
    if (!env.DEMO_MODE || !isMockMode()) throw Forbidden('Mock confirm disabled');
    const u = (req as any).user;
    const { orderId } = req.body as { orderId: string };
    const row = await prisma.payment.findUnique({ where: { razorpayOrderId: orderId } });
    if (!row || row.userId !== u.id) throw BadRequest('Order not found');
    await prisma.$transaction([
      prisma.payment.update({ where: { id: row.id }, data: { status: 'PAID', razorpayPaymentId: `mockp_${Date.now()}` } }),
      prisma.user.update({ where: { id: u.id }, data: { plan: row.plan } }),
    ]);
    res.json({ ok: true, plan: row.plan });
  } catch (e) { next(e); }
}
EOF

cat > src/routes/payments.ts <<'EOF'
import { Router, type RequestHandler } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { validate } from '../middleware/validate.js';
import { paymentOrderSchema } from '../validators/payments.js';
import { createOrder, webhook, mockConfirm } from '../controllers/payments.js';

// why: Razorpay HMAC is computed over raw bytes, so we need those before JSON parsing.
export const rawWebhookBody: RequestHandler = (req, _res, next) => {
  const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => chunks.push(c));
  req.on('end', () => {
    (req as any).rawBody = Buffer.concat(chunks);
    next();
  });
  req.on('error', next);
};

export const paymentsRouter = Router();
paymentsRouter.post('/order', requireAuth, validate(paymentOrderSchema), createOrder);
paymentsRouter.post('/webhook', webhook);
paymentsRouter.post('/mock-confirm', requireAuth, mockConfirm);
EOF

# ----------------------------------------------------------------------------
# Sockets
# ----------------------------------------------------------------------------
cat > src/sockets/index.ts <<'EOF'
import type { Server, Socket } from 'socket.io';
import { verifyAccess } from '../lib/jwt.js';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';

let ioRef: Server | null = null;

async function isMember(matchId: string, userId: string): Promise<boolean> {
  const m = await prisma.match.findUnique({ where: { id: matchId } });
  return !!m && (m.userA === userId || m.userB === userId);
}

export function attachSockets(io: Server): void {
  ioRef = io;

  io.use((socket, next) => {
    try {
      const token = (socket.handshake.auth as any)?.token || socket.handshake.query?.token;
      if (!token) return next(new Error('unauthorised'));
      const payload = verifyAccess(String(token));
      (socket as any).userId = payload.sub;
      next();
    } catch { next(new Error('unauthorised')); }
  });

  io.on('connection', (socket: Socket) => {
    const userId = (socket as any).userId as string;
    socket.join(`user:${userId}`);
    logger.info({ userId }, 'socket connected');

    socket.on('typing', async ({ matchId }: { matchId: string }) => {
      if (!(await isMember(matchId, userId))) return;
      const match = await prisma.match.findUnique({ where: { id: matchId } });
      if (!match) return;
      const otherId = match.userA === userId ? match.userB : match.userA;
      io.to(`user:${otherId}`).emit('typing', { matchId, userId });
    });

    socket.on('read', async ({ matchId }: { matchId: string }) => {
      if (!(await isMember(matchId, userId))) return;
      await prisma.message.updateMany({ where: { matchId, senderId: { not: userId }, readAt: null }, data: { readAt: new Date() } });
      const match = await prisma.match.findUnique({ where: { id: matchId } });
      if (!match) return;
      const otherId = match.userA === userId ? match.userB : match.userA;
      io.to(`user:${otherId}`).emit('read', { matchId, by: userId });
    });

    socket.on('disconnect', () => logger.info({ userId }, 'socket disconnected'));
  });
}

export function emitMessage(toUserId: string, message: any): void {
  if (!ioRef) return;
  ioRef.to(`user:${toUserId}`).emit('message', message);
}

export function emitMatchEvent(aUserId: string, bUserId: string, matchId: string): void {
  if (!ioRef) return;
  ioRef.to(`user:${aUserId}`).emit('match', { matchId, with: bUserId });
  ioRef.to(`user:${bUserId}`).emit('match', { matchId, with: aUserId });
}
EOF

# ----------------------------------------------------------------------------
# docs/openapi.yaml  (hand-written)
# ----------------------------------------------------------------------------
cat > docs/openapi.yaml <<'EOF'
openapi: 3.0.3
info:
  title: FlatFit API
  version: 1.0.0
  description: Backend for the FlatFit roommate-matching app.
servers:
  - url: http://localhost:4000
  - url: https://flatfit-api.onrender.com
components:
  securitySchemes:
    bearer: { type: http, scheme: bearer, bearerFormat: JWT }
security:
  - bearer: []
paths:
  /health:
    get:
      summary: Service health
      security: []
      responses: { '200': { description: OK } }
  /auth/send-otp:
    post:
      summary: Send an OTP
      security: []
      requestBody: { required: true }
      responses: { '200': { description: OK }, '429': { description: Rate limited } }
  /auth/verify-otp:
    post:
      summary: Verify OTP and sign in
      security: []
      responses: { '200': { description: OK }, '400': { description: Bad OTP } }
  /auth/refresh:
    post:
      summary: Rotate the refresh token
      security: []
      responses: { '200': { description: OK }, '401': { description: Reuse } }
  /auth/logout:
    post:
      summary: Logout
      responses: { '204': { description: OK } }
  /me:
    get:
      summary: Current user
      responses: { '200': { description: OK }, '401': { description: Auth }  }
  /me/profile:
    put: { summary: Update profile, responses: { '200': { description: OK } } }
  /me/lifestyle:
    put: { summary: Update lifestyle, responses: { '200': { description: OK } } }
  /me/deal-breakers:
    put: { summary: Replace deal-breakers, responses: { '200': { description: OK } } }
  /me/photos/upload-url:
    post: { summary: Signed upload url, responses: { '200': { description: OK } } }
  /discover:
    get: { summary: Discover candidates, responses: { '200': { description: OK } } }
  /swipes:
    post: { summary: Swipe, responses: { '200': { description: OK } } }
  /matches:
    get: { summary: Matches list, responses: { '200': { description: OK } } }
  /matches/{id}/compatibility:
    get: { summary: Compatibility breakdown, responses: { '200': { description: OK }, '404': { description: Not found } } }
  /matches/{id}/messages:
    get: { summary: Messages list, responses: { '200': { description: OK } } }
    post: { summary: Send message, responses: { '200': { description: OK } } }
  /matches/{id}/agreement:
    get: { summary: Get agreement, responses: { '200': { description: OK } } }
    post: { summary: Upsert agreement, responses: { '200': { description: OK } } }
  /agreements/{id}/accept:
    put: { summary: Accept agreement, responses: { '200': { description: OK } } }
  /listings:
    get: { summary: Listings, security: [], responses: { '200': { description: OK } } }
    post: { summary: Create listing, responses: { '200': { description: OK } } }
  /listings/{id}:
    get: { summary: Listing, security: [], responses: { '200': { description: OK } } }
    put: { summary: Update listing, responses: { '200': { description: OK } } }
    delete: { summary: Delete listing, responses: { '204': { description: OK } } }
  /reports:
    post: { summary: Report a user, responses: { '200': { description: OK } } }
  /blocks:
    get: { summary: My blocks, responses: { '200': { description: OK } } }
    post: { summary: Block a user, responses: { '200': { description: OK } } }
  /blocks/{userId}:
    delete: { summary: Unblock, responses: { '204': { description: OK } } }
  /verify/selfie:
    post: { summary: Submit selfie, responses: { '200': { description: OK } } }
  /admin/verifications:
    get: { summary: Pending selfies, responses: { '200': { description: OK } } }
  /admin/verifications/{id}:
    put: { summary: Approve or reject, responses: { '200': { description: OK } } }
  /payments/order:
    post: { summary: Create order, responses: { '200': { description: OK } } }
  /payments/webhook:
    post:
      summary: Razorpay webhook
      security: []
      responses: { '200': { description: OK } }
  /payments/mock-confirm:
    post: { summary: Dev-only mock confirm, responses: { '200': { description: OK } } }
EOF

# ----------------------------------------------------------------------------
# docs/DEPLOY.md  DECISIONS.md  API.md  README.md  render.yaml
# ----------------------------------------------------------------------------
cat > docs/DEPLOY.md <<'EOF'
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
EOF

cat > docs/DECISIONS.md <<'EOF'
# Decisions

- Node 22 LTS (works for Node 20 spec target; `engines.node` is set to `>=20`).
- ESM output (`"type": "module"` + NodeNext).
- Listing model extends BACKEND_SPEC with `bills:number` and `description:string` because the frontend requires them.
- `mode` accepts both `HAS_FLAT|NEEDS_FLAT` and `have-flat|need-flat`; canonical form is `HAS_FLAT|NEEDS_FLAT`.
- Agreement `rules` stored as structured JSON per spec; the frontend's string[] view is a separate projection.
- Payments mode auto-switches to `mock` when Razorpay keys are missing; `/payments/mock-confirm` only works when `DEMO_MODE=true`.
- Redis replaced by `node-cache` with 60s TTL per spec's "no Redis" rule.
- OTP provider pattern: `ConsoleProvider` logs code in dev; `MSG91Provider` is left as a TODO stub for when real SMS is wired.
- Discover cache key is `discover:<userId>:<city>:<cursor>` and is invalidated on every swipe or profile update.
EOF

cat > docs/API.md <<'EOF'
# API

See `/docs` on the running server (Swagger UI) or `docs/openapi.yaml`.
EOF

cat > README.md <<'EOF'
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
EOF

cat > render.yaml <<'EOF'
services:
  - type: web
    name: flatfit-api
    env: node
    plan: free
    buildCommand: npm ci && npx prisma generate && npm run build
    startCommand: npx prisma migrate deploy && node dist/server.js
    envVars:
      - key: NODE_ENV
        value: production
      - key: LOG_LEVEL
        value: info
      - key: PORT
        value: 4000
      - key: ACCESS_TTL
        value: 15m
      - key: REFRESH_TTL
        value: 7d
      - key: SUPABASE_BUCKET
        value: flatfit-public
      - key: SUPABASE_PRIVATE_BUCKET
        value: flatfit-private
      - key: DEMO_MODE
        value: "true"
      - key: DEMO_PHONE
        value: "+919999999999"
      - key: DEMO_OTP
        value: "123456"
      - key: FRONTEND_ORIGIN
        sync: false
      - key: DATABASE_URL
        sync: false
      - key: DIRECT_URL
        sync: false
      - key: JWT_ACCESS_SECRET
        sync: false
      - key: JWT_REFRESH_SECRET
        sync: false
      - key: SUPABASE_URL
        sync: false
      - key: SUPABASE_SERVICE_ROLE_KEY
        sync: false
EOF

# ----------------------------------------------------------------------------
# GitHub Actions
# ----------------------------------------------------------------------------
cat > .github/workflows/ci.yml <<'EOF'
name: ci
on:
  pull_request:
  push:
    branches: [ main ]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npx prisma generate
      - run: npm run lint --if-present
      - run: npm run typecheck
      - run: npm test --if-present
      - name: npm audit (high)
        run: npm audit --audit-level=high || exit 1
EOF

cat > .github/workflows/keepalive.yml <<'EOF'
name: keepalive
on:
  schedule:
    - cron: '0 */6 * * *'
  workflow_dispatch:
jobs:
  ping:
    runs-on: ubuntu-latest
    steps:
      - name: hit health
        run: |
          code=$(curl -s -o /dev/null -w "%{http_code}" "${{ secrets.BACKEND_URL }}/health")
          echo "status $code"
          if [ "$code" != "200" ]; then exit 1; fi
EOF

# ----------------------------------------------------------------------------
# Postman collection
# ----------------------------------------------------------------------------
cat > postman/flatfit.postman_collection.json <<'EOF'
{
  "info": { "name": "FlatFit", "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" },
  "variable": [
    { "key": "baseUrl", "value": "http://localhost:4000" },
    { "key": "accessToken", "value": "" },
    { "key": "matchId", "value": "" }
  ],
  "item": [
    { "name": "Health",
      "request": { "method": "GET", "url": "{{baseUrl}}/health" },
      "event": [ { "listen": "test", "script": { "exec": ["pm.test('200', ()=>pm.response.to.have.status(200));"] } } ]
    },
    { "name": "Auth: send-otp",
      "request": { "method": "POST", "url": "{{baseUrl}}/auth/send-otp",
        "header":[{"key":"Content-Type","value":"application/json"}],
        "body": { "mode": "raw", "raw": "{\"phone\":\"+919999999999\"}" } },
      "event": [ { "listen": "test", "script": { "exec": ["pm.test('200', ()=>pm.response.to.have.status(200));"] } } ]
    },
    { "name": "Auth: verify-otp",
      "request": { "method": "POST", "url": "{{baseUrl}}/auth/verify-otp",
        "header":[{"key":"Content-Type","value":"application/json"}],
        "body": { "mode": "raw", "raw": "{\"phone\":\"+919999999999\",\"otp\":\"123456\"}" } },
      "event": [ { "listen": "test", "script": { "exec": [
        "pm.test('200', ()=>pm.response.to.have.status(200));",
        "pm.collectionVariables.set('accessToken', pm.response.json().accessToken);"
      ] } } ]
    },
    { "name": "Me",
      "request": { "method": "GET", "url": "{{baseUrl}}/me",
        "header":[{"key":"Authorization","value":"Bearer {{accessToken}}"}] },
      "event": [ { "listen": "test", "script": { "exec": ["pm.test('200', ()=>pm.response.to.have.status(200));"] } } ]
    },
    { "name": "Discover",
      "request": { "method": "GET", "url": "{{baseUrl}}/discover",
        "header":[{"key":"Authorization","value":"Bearer {{accessToken}}"}] },
      "event": [ { "listen": "test", "script": { "exec": ["pm.test('200', ()=>pm.response.to.have.status(200));"] } } ]
    },
    { "name": "Matches",
      "request": { "method": "GET", "url": "{{baseUrl}}/matches",
        "header":[{"key":"Authorization","value":"Bearer {{accessToken}}"}] },
      "event": [ { "listen": "test", "script": { "exec": [
        "pm.test('200', ()=>pm.response.to.have.status(200));",
        "const items = pm.response.json().items; if (items && items[0]) pm.collectionVariables.set('matchId', items[0].matchId);"
      ] } } ]
    },
    { "name": "Listings",
      "request": { "method": "GET", "url": "{{baseUrl}}/listings" },
      "event": [ { "listen": "test", "script": { "exec": ["pm.test('200', ()=>pm.response.to.have.status(200));"] } } ]
    },
    { "name": "Blocks list",
      "request": { "method": "GET", "url": "{{baseUrl}}/blocks",
        "header":[{"key":"Authorization","value":"Bearer {{accessToken}}"}] },
      "event": [ { "listen": "test", "script": { "exec": ["pm.test('200', ()=>pm.response.to.have.status(200));"] } } ]
    },
    { "name": "Payments: order",
      "request": { "method": "POST", "url": "{{baseUrl}}/payments/order",
        "header":[{"key":"Authorization","value":"Bearer {{accessToken}}"},{"key":"Content-Type","value":"application/json"}],
        "body": { "mode": "raw", "raw": "{\"plan\":\"VERIFIED\"}" } },
      "event": [ { "listen": "test", "script": { "exec": ["pm.test('200', ()=>pm.response.to.have.status(200));"] } } ]
    }
  ]
}
EOF

# ----------------------------------------------------------------------------
# scripts/smoke.ts
# ----------------------------------------------------------------------------
cat > scripts/smoke.ts <<'EOF'
import 'dotenv/config';

const BASE = process.env.BASE_URL ?? 'http://localhost:4000';
type Row = { name: string; ok: boolean; detail?: string };
const rows: Row[] = [];

async function j(path: string, init?: RequestInit) {
  const r = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  const text = await r.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch {}
  return { status: r.status, body, headers: r.headers };
}

function record(name: string, ok: boolean, detail?: string) { rows.push({ name, ok, detail }); }

async function main() {
  const phone = process.env.DEMO_PHONE ?? '+919999999999';
  const otp = process.env.DEMO_OTP ?? '123456';

  const health = await j('/health');
  record('GET /health', health.status === 200 && health.body?.status === 'ok');

  await j('/auth/send-otp', { method: 'POST', body: JSON.stringify({ phone }) });
  record('POST /auth/send-otp', true);

  const v = await j('/auth/verify-otp', { method: 'POST', body: JSON.stringify({ phone, otp }) });
  const token = v.body?.accessToken as string | undefined;
  record('POST /auth/verify-otp', v.status === 200 && !!token);

  const auth = { authorization: `Bearer ${token ?? ''}` };
  const me = await j('/me', { headers: auth });
  record('GET /me', me.status === 200);

  const disc = await j('/discover', { headers: auth });
  record('GET /discover', disc.status === 200);

  const mt = await j('/matches', { headers: auth });
  record('GET /matches', mt.status === 200);

  const list = await j('/listings');
  record('GET /listings', list.status === 200);

  const blocks = await j('/blocks', { headers: auth });
  record('GET /blocks', blocks.status === 200);

  const order = await j('/payments/order', { method: 'POST', headers: auth, body: JSON.stringify({ plan: 'VERIFIED' }) });
  record('POST /payments/order', order.status === 200);

  console.log('\nFlatFit smoke report');
  console.log('-----------------------------------');
  for (const r of rows) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  ' + r.detail : ''}`);
  const bad = rows.filter((r) => !r.ok).length;
  console.log(`-----------------------------------\n${rows.length - bad}/${rows.length} passed`);
  process.exit(bad === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
EOF

# ----------------------------------------------------------------------------
# Tests
# ----------------------------------------------------------------------------
cat > tests/matching.test.ts <<'EOF'
import { describe, it, expect } from 'vitest';
import { sleepScore, cleanlinessScore, smokingDrinkingScore, guestsNoiseScore, budgetScore, petsDietCookingScore, computeScore, circularMinutesDiff } from '../src/services/matching.js';

const base = { sleepTime: 23*60, wakeTime: 7*60, cleanliness: 4, smoking: false, drinking: false, pets: false, diet: 'any', guestsLevel: 3, noiseLevel: 3, cooking: 'sometimes', city: 'Gurugram', budgetMin: 10000, budgetMax: 20000 };

describe('matching factors', () => {
  it('circular minute diff wraps midnight', () => {
    expect(circularMinutesDiff(23*60, 1*60)).toBe(120);
  });
  it('sleep score is 1 when identical', () => {
    expect(sleepScore(base as any, base as any)).toBeCloseTo(1, 5);
  });
  it('cleanliness score falls linearly', () => {
    expect(cleanlinessScore(base as any, { ...base, cleanliness: 2 } as any)).toBeCloseTo(0.5, 5);
  });
  it('smoking+drinking: both equal = 1', () => {
    expect(smokingDrinkingScore(base as any, base as any)).toBe(1);
  });
  it('smoking+drinking: one differs = 0.4', () => {
    expect(smokingDrinkingScore(base as any, { ...base, smoking: true } as any)).toBeCloseTo(0.4, 5);
  });
  it('guests+noise scores 1 on identical', () => {
    expect(guestsNoiseScore(base as any, base as any)).toBe(1);
  });
  it('budget overlap', () => {
    expect(budgetScore(base as any, { ...base, budgetMin: 15000, budgetMax: 25000 } as any)).toBeCloseTo(5000/15000, 4);
  });
  it('pets/diet/cooking all equal = 1', () => {
    expect(petsDietCookingScore(base as any, base as any)).toBe(1);
  });
  it('compute score returns 100 when identical', () => {
    expect(computeScore(base as any, base as any).score).toBe(100);
  });
});
EOF

cat > tests/health.test.ts <<'EOF'
import { describe, it, expect } from 'vitest';
import request from 'supertest';

// why: lightweight self-contained check - no DB needed to assert the route exists.
describe('GET /health', () => {
  it('returns ok shape', async () => {
    const { buildApp } = await import('../src/app.js');
    const app = buildApp();
    const r = await request(app).get('/health');
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty('status', 'ok');
    expect(r.body).toHaveProperty('db');
    expect(r.body).toHaveProperty('time');
  });
});
EOF

cat > tests/auth-shape.test.ts <<'EOF'
import { describe, it, expect } from 'vitest';
import request from 'supertest';

describe('auth route shapes', () => {
  it('rejects invalid phone', async () => {
    const { buildApp } = await import('../src/app.js');
    const app = buildApp();
    const r = await request(app).post('/auth/send-otp').send({ phone: 'not-a-phone' });
    expect(r.status).toBe(400);
    expect(r.body?.error?.code).toBe('VALIDATION_ERROR');
  });

  it('rejects unauth on /me', async () => {
    const { buildApp } = await import('../src/app.js');
    const app = buildApp();
    const r = await request(app).get('/me');
    expect(r.status).toBe(401);
  });
});
EOF

cat > tests/vitest.config.ts <<'EOF'
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { include: ['tests/**/*.test.ts'], environment: 'node', globals: false },
});
EOF

# ----------------------------------------------------------------------------
# .env.example (refreshed to include SUPABASE_PRIVATE_BUCKET)
# ----------------------------------------------------------------------------
cat > .env.example <<'EOF'
# --- Runtime
NODE_ENV=development
PORT=4000
LOG_LEVEL=info
FRONTEND_ORIGIN=https://flatmate-five-zeta.vercel.app

# --- Database (Supabase)
DATABASE_URL=postgresql://USER:PASSWORD@POOLER-HOST:6543/postgres?pgbouncer=true&connection_limit=1
DIRECT_URL=postgresql://USER:PASSWORD@DIRECT-HOST:5432/postgres

# --- Auth
JWT_ACCESS_SECRET=change-me-to-a-64-char-random-string
JWT_REFRESH_SECRET=change-me-to-another-64-char-random-string
ACCESS_TTL=15m
REFRESH_TTL=7d

# --- Supabase storage
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_BUCKET=flatfit-public
SUPABASE_PRIVATE_BUCKET=flatfit-private

# --- Demo / dev
DEMO_MODE=true
DEMO_PHONE=+919999999999
DEMO_OTP=123456

# --- Payments (optional; if blank -> mock mode)
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=
EOF

# ----------------------------------------------------------------------------
# tsconfig update so tests can import compiled .js from src via NodeNext
# ----------------------------------------------------------------------------
cat > tsconfig.json <<'EOF'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "noImplicitOverride": true,
    "noUncheckedIndexedAccess": false,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "declaration": false,
    "sourceMap": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*.ts", "tests/**/*.ts", "scripts/**/*.ts", "prisma/seed.ts"],
  "exclude": ["node_modules", "dist"]
}
EOF

cat > tests/tsconfig.json <<'EOF'
{ "extends": "../tsconfig.json", "include": ["./**/*.ts", "../src/**/*.ts"] }
EOF

echo "==> All files generated."
echo "Next steps:"
echo "  1) npm install"
echo "  2) Fill DATABASE_URL / DIRECT_URL / SUPABASE_* in .env"
echo "  3) npx prisma generate && npx prisma migrate deploy && npm run seed"
echo "  4) npm run dev"
