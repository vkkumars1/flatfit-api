import 'dotenv/config';
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  FRONTEND_ORIGIN: z.string().default('http://localhost:3000').transform((value) => {
    const origins = value.split(',').map((origin) => origin.trim()).filter(Boolean);
    return origins.map((origin) => {
      try {
        const parsed = new URL(origin);
        if (parsed.origin !== origin.replace(/\/$/, '')) throw new Error();
        return parsed.origin;
      } catch {
        throw new Error('FRONTEND_ORIGIN must be a comma-separated list of valid origins');
      }
    });
  }),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL required'),
  DIRECT_URL: z.string().min(1, 'DIRECT_URL required'),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be >= 32 chars'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be >= 32 chars'),
  ACCESS_TTL: z.string().default('15m'),
  REFRESH_TTL: z.string().default('7d'),

  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_BUCKET: z.string().default('flatfit-public'),
  SUPABASE_PRIVATE_BUCKET: z.string().default('flatfit-private'),

  DEMO_MODE: z
    .union([z.literal('true'), z.literal('false')])
    .transform((v) => v === 'true')
    .default(false),
  DEMO_PHONE: z.string().default('+919999999999'),
  DEMO_OTP: z.string().default('123456'),

  RAZORPAY_KEY_ID: z.string().optional().default(''),
  RAZORPAY_KEY_SECRET: z.string().optional().default(''),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional().default(''),

  FIREBASE_PROJECT_ID: z.string().optional().default(''),
  FIREBASE_CLIENT_EMAIL: z.string().optional().default(''),
  FIREBASE_PRIVATE_KEY: z.string().optional().default(''),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('\n[env] Invalid environment variables:');
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = parsed.data;

// why: payments auto-fallback to mock if Razorpay creds not configured, per spec
export const PAYMENTS_MODE: 'live' | 'mock' =
  env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET && env.RAZORPAY_WEBHOOK_SECRET ? 'live' : 'mock';

export const IS_PROD = env.NODE_ENV === 'production';
export const IS_TEST = env.NODE_ENV === 'test';
