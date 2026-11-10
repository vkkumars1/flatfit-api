import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { validate } from '../middleware/validate.js';
import { agreementRulesSchema } from '../validators/agreement.js';
import { getAgreement, upsertAgreement, acceptAgreement } from '../controllers/agreement.js';

export const agreementRouter = Router();
agreementRouter.use(requireAuth);
agreementRouter.get('/matches/:id/agreement', getAgreement);
agreementRouter.post('/matches/:id/agreement', validate(agreementRulesSchema), upsertAgreement);
agreementRouter.put('/agreements/:id/accept', acceptAgreement);
