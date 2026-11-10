import { z } from 'zod';
export const swipeSchema = z.object({
  toUserId: z.string().min(1),
  action: z.union([z.enum(['LIKE','PASS','SUPER']), z.enum(['like','pass','super'])]).transform((v) => v.toUpperCase() as 'LIKE'|'PASS'|'SUPER'),
});
