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
