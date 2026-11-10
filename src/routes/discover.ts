import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { getDiscover } from '../controllers/discover.js';

export const discoverRouter = Router();
discoverRouter.use(requireAuth);
discoverRouter.get('/', getDiscover);
