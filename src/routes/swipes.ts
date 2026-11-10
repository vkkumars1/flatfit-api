import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { validate } from '../middleware/validate.js';
import { swipeSchema } from '../validators/swipes.js';
import { postSwipe } from '../controllers/swipes.js';

export const swipesRouter = Router();
swipesRouter.use(requireAuth);
swipesRouter.post('/', validate(swipeSchema), postSwipe);
