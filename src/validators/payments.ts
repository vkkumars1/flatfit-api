import { z } from 'zod';

export const paymentOrderSchema = z.object({
  plan: z.enum(['VERIFIED', 'BOOST']),
});

// why: synchronous verify runs client-side after checkout callback so user sees
// plan upgraded instantly without waiting on Razorpay's webhook retry loop.
export const paymentVerifySchema = z.object({
  orderId: z.string().min(1),
  paymentId: z.string().min(1),
  signature: z.string().min(1),
});
