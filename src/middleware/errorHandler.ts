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
