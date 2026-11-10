import { z } from 'zod';
export const paymentOrderSchema = z.object({ plan: z.enum(['VERIFIED','BOOST']) });
