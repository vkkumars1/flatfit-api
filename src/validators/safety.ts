import { z } from 'zod';
export const reportSchema = z.object({
  targetUserId: z.string().min(1),
  reason: z.string().min(2).max(200),
  details: z.string().max(1000).optional(),
});
export const blockSchema = z.object({ targetUserId: z.string().min(1) });
export const selfieSchema = z.object({ path: z.string().min(3) });
