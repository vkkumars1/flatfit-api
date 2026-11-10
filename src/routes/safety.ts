import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { validate } from '../middleware/validate.js';
import { reportSchema, blockSchema, selfieSchema } from '../validators/safety.js';
import { postReport, listBlocks, postBlock, deleteBlock, postSelfie } from '../controllers/safety.js';

export const safetyRouter = Router();
safetyRouter.use(requireAuth);
safetyRouter.post('/reports', validate(reportSchema), postReport);
safetyRouter.get('/blocks', listBlocks);
safetyRouter.post('/blocks', validate(blockSchema), postBlock);
safetyRouter.delete('/blocks/:userId', deleteBlock);
safetyRouter.post('/verify/selfie', validate(selfieSchema), postSelfie);
