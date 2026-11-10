import { z } from 'zod';
export const sendMessageSchema = z.object({ text: z.string().min(1).max(1000) });
