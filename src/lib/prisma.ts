import { PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';

// why: single PrismaClient across the app avoids pool exhaustion on serverless.
export const prisma = new PrismaClient({
  log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});
