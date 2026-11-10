import { z } from 'zod';
export const cursorQuery = z.object({
  cursor: z.string().optional(),
  city: z.string().optional(),
  min: z.coerce.number().int().optional(),
  max: z.coerce.number().int().optional(),
  verified: z.coerce.boolean().optional(),
});
export const idParam = z.object({ id: z.string().min(1) });
