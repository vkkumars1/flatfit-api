import { Router, type RequestHandler } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { validate } from '../middleware/validate.js';
import { paymentOrderSchema, paymentVerifySchema } from '../validators/payments.js';
import { createOrder, webhook, verifyPayment, mockConfirm } from '../controllers/payments.js';

// why: Razorpay HMAC is computed over raw bytes, so we need those before JSON parsing.
export const rawWebhookBody: RequestHandler = (req, _res, next) => {
  const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => chunks.push(c));
  req.on('end', () => {
    (req as any).rawBody = Buffer.concat(chunks);
    next();
  });
  req.on('error', next);
};

export const paymentsRouter = Router();
paymentsRouter.post('/order', requireAuth, validate(paymentOrderSchema), createOrder);
paymentsRouter.post('/verify', requireAuth, validate(paymentVerifySchema), verifyPayment);
paymentsRouter.post('/webhook', webhook);
paymentsRouter.post('/mock-confirm', requireAuth, mockConfirm);
