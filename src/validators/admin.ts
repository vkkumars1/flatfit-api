import { z } from 'zod';
export const verificationReviewSchema = z.object({ status: z.enum(['approved','rejected']) });
