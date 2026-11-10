import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';
import { hash, verifyHash } from '../lib/hash.js';
import { logger } from '../lib/logger.js';
import { BadRequest, TooMany } from '../lib/errors.js';

const TTL_MS = 5 * 60_000;
const MAX_ATTEMPTS = 5;

function generate6(): string { return String(Math.floor(100000 + Math.random() * 900000)); }

// why: tiny interface lets us swap ConsoleProvider for real SMS later.
interface OtpProvider { send(phone: string, code: string): Promise<void>; }
const ConsoleProvider: OtpProvider = {
  async send(phone, code) {
    if (env.NODE_ENV !== 'production') logger.info({ phone, code }, 'DEV OTP');
  },
};
const provider: OtpProvider = ConsoleProvider;

export async function sendOtp(phone: string): Promise<{ resendInSeconds: number }> {
  const code = env.DEMO_MODE && phone === env.DEMO_PHONE ? env.DEMO_OTP : generate6();
  const codeHash = await hash(code);
  const expiresAt = new Date(Date.now() + TTL_MS);
  await prisma.otpCode.create({ data: { phone, codeHash, expiresAt } });
  await provider.send(phone, code);
  return { resendInSeconds: 30 };
}

export async function verifyOtp(phone: string, otp: string): Promise<boolean> {
  const row = await prisma.otpCode.findFirst({ where: { phone, usedAt: null }, orderBy: { createdAt: 'desc' } });
  if (!row) throw BadRequest('No OTP requested');
  if (row.expiresAt.getTime() < Date.now()) throw BadRequest('OTP expired');
  if (row.attempts >= MAX_ATTEMPTS) throw TooMany('OTP locked, request a new one');

  // Demo override: when DEMO_MODE and phone matches, DEMO_OTP always passes.
  if (env.DEMO_MODE && phone === env.DEMO_PHONE && otp === env.DEMO_OTP) {
    await prisma.otpCode.update({ where: { id: row.id }, data: { usedAt: new Date() } });
    return true;
  }
  const ok = await verifyHash(otp, row.codeHash);
  if (!ok) {
    await prisma.otpCode.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
    throw BadRequest('Invalid OTP');
  }
  await prisma.otpCode.update({ where: { id: row.id }, data: { usedAt: new Date() } });
  return true;
}
