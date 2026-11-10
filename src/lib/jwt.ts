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
