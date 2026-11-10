import { env } from '../config/env.js';
import crypto from 'node:crypto';

export const PLAN_PRICES = { VERIFIED: 19900, BOOST: 29900 } as const;

export function isMockMode(): boolean {
  return !env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET;
}

let rzp: any = null;
export async function getRazorpay() {
  if (isMockMode()) return null;
  if (!rzp) {
    const mod = await import('razorpay');
    const Razorpay = (mod as any).default ?? mod;
    rzp = new Razorpay({ key_id: env.RAZORPAY_KEY_ID!, key_secret: env.RAZORPAY_KEY_SECRET! });
  }
  return rzp;
}

export function verifyWebhookSignature(rawBody: Buffer | string, signature: string): boolean {
  if (!env.RAZORPAY_WEBHOOK_SECRET) return false;
  const expected = crypto.createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET).update(rawBody as any).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
