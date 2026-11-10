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
