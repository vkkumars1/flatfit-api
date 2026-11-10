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
