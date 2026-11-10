import { z } from 'zod';
export const agreementRulesSchema = z.object({
  rules: z.object({
    guests:     z.string().max(200).optional(),
    quietHours: z.string().max(200).optional(),
    dishes:     z.string().max(200).optional(),
    bills:      z.string().max(200).optional(),
    cleaning:   z.string().max(200).optional(),
    smoking:    z.string().max(200).optional(),
    pets:       z.string().max(200).optional(),
  }).passthrough(),
});
