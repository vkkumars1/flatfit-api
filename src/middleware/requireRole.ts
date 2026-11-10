import type { RequestHandler } from 'express';
import { Forbidden } from '../lib/errors.js';

export const requireRole = (role: 'ADMIN' | 'USER'): RequestHandler => (req, _res, next) => {
  if ((req as any).user?.role !== role) return next(Forbidden('Forbidden'));
  next();
};
