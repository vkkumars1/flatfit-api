import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import YAML from 'yaml';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { errorHandler } from './middleware/errorHandler.js';
import { notFound } from './middleware/notFound.js';
import { globalLimiter } from './middleware/rateLimiters.js';
import { requireAuth } from './middleware/requireAuth.js';
import { requireRole } from './middleware/requireRole.js';
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
  const allowedOrigins = env.NODE_ENV === 'production'
    ? env.FRONTEND_ORIGIN
    : [...env.FRONTEND_ORIGIN, 'http://localhost:3000'];
  app.use(cors({ origin: allowedOrigins, credentials: true }));
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

  // Public routes - no auth required per spec Security Checklist #2
  app.use(healthRouter);
  app.use('/auth', authRouter);
  app.use('/payments', paymentsRouter); // internal routes self-apply auth; webhook stays bare

  // why: listings browse is public, mutations enforce auth per-route (see listings.ts).
  app.use('/listings', listingsRouter);

  // Protected routes - requireAuth applied at the mount per spec Security Checklist #2
  app.use('/me', requireAuth, meRouter);
  app.use('/discover', requireAuth, discoverRouter);
  app.use('/swipes', requireAuth, swipesRouter);
  app.use('/matches', requireAuth, matchesRouter);
  app.use(requireAuth, agreementRouter);
  app.use(requireAuth, safetyRouter);

  // why: admin area needs both auth + ADMIN role.
  app.use('/admin', requireAuth, requireRole('ADMIN'), adminRouter);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
