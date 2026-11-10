import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireRole } from '../middleware/requireRole.js';
import { validate } from '../middleware/validate.js';
import { verificationReviewSchema } from '../validators/admin.js';
import { listPendingVerifications, reviewVerification } from '../controllers/admin.js';

export const adminRouter = Router();
adminRouter.use(requireAuth);
adminRouter.use(requireRole('ADMIN'));
adminRouter.get('/verifications', listPendingVerifications);
adminRouter.put('/verifications/:id', validate(verificationReviewSchema), reviewVerification);
