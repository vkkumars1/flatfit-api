import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { validate } from '../middleware/validate.js';
import { profileSchema, lifestyleSchema, dealBreakersSchema, uploadUrlSchema } from '../validators/me.js';
import { getMe, putProfile, putLifestyle, putDealBreakers, postUploadUrl } from '../controllers/me.js';

export const meRouter = Router();
meRouter.use(requireAuth);
meRouter.get('/', getMe);
meRouter.put('/profile', validate(profileSchema), putProfile);
meRouter.put('/lifestyle', validate(lifestyleSchema), putLifestyle);
meRouter.put('/deal-breakers', validate(dealBreakersSchema), putDealBreakers);
meRouter.post('/photos/upload-url', validate(uploadUrlSchema), postUploadUrl);
