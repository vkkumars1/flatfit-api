import { z } from 'zod';
export const listingCreateSchema = z.object({
  title: z.string().min(2).max(120),
  city: z.string().min(2).max(80),
  locality: z.string().min(2).max(120),
  rent: z.number().int().positive(),
  deposit: z.number().int().nonnegative().default(0),
  bills: z.number().int().nonnegative().default(0),
  description: z.string().max(1000).default(''),
  photos: z.array(z.string()).max(10).default([]),
  amenities: z.array(z.string()).max(30).default([]),
  availableFrom: z.string().min(4),
});
export const listingUpdateSchema = listingCreateSchema.partial();
