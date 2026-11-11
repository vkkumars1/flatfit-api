import { z } from 'zod';
export const sendOtpSchema = z.object({ phone: z.string().regex(/^\+\d{10,15}$/, 'Phone must be E.164') });
export const verifyOtpSchema = z.object({ phone: z.string().regex(/^\+\d{10,15}$/), otp: z.string().regex(/^\d{6}$/) });

export const emailSignupSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(6).max(128),
  name: z.string().trim().min(1).max(80).optional(),
});

export const emailSigninSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(6).max(128),
});
export const firebaseVerifySchema = z.object({ idToken: z.string().min(10).max(4096) });
