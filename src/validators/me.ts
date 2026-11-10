import { z } from 'zod';

// why: accept both frontend kebab-case and backend enum form of mode.
const mode = z.union([z.enum(['HAS_FLAT', 'NEEDS_FLAT']), z.enum(['have-flat', 'need-flat'])])
  .transform((v) => (v === 'have-flat' ? 'HAS_FLAT' : v === 'need-flat' ? 'NEEDS_FLAT' : v));

export const profileSchema = z.object({
  name: z.string().min(2).max(80),
  gender: z.string().min(1),
  dob: z.string().datetime().or(z.string().min(4)),
  city: z.string().min(2).max(80),
  bio: z.string().max(400).default(''),
  budgetMin: z.number().int().positive(),
  budgetMax: z.number().int().positive(),
  moveInDate: z.string().min(4),
  occupation: z.string().min(1),
  mode: mode,
  photos: z.array(z.string()).max(6).default([]),
}).refine((d) => d.budgetMax >= d.budgetMin, { message: 'budgetMax must be >= budgetMin' });

export const lifestyleSchema = z.object({
  sleepTime: z.number().int().min(0).max(1440),
  wakeTime:  z.number().int().min(0).max(1440),
  cleanliness: z.number().int().min(1).max(5),
  smoking:  z.boolean(),
  drinking: z.boolean(),
  pets:     z.boolean(),
  diet:     z.string().min(1),
  guestsLevel: z.number().int().min(1).max(5),
  noiseLevel:  z.number().int().min(1).max(5),
  cooking:  z.string().min(1),
});

export const dealBreakersSchema = z.array(z.object({ key: z.string().min(1), value: z.string().min(1) })).max(20);

export const uploadUrlSchema = z.object({
  fileType: z.string().min(3),
  fileSize: z.number().int().positive().max(5 * 1024 * 1024),
  purpose: z.enum(['profile', 'selfie', 'listing']),
});
