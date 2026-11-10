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
