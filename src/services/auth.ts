import { prisma } from '../lib/prisma.js';
import { hash, verifyHash } from '../lib/hash.js';
import { signAccess, signRefresh, verifyRefresh } from '../lib/jwt.js';
import { Unauthorized } from '../lib/errors.js';
import { randomUUID } from 'node:crypto';
import ms from './ms.js';
import { env } from '../config/env.js';

export async function issueTokens(userId: string, familyId?: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw Unauthorized('User missing');
  const jti = randomUUID();
  const family = familyId ?? randomUUID();
  const access = signAccess({ sub: user.id, role: user.role, plan: user.plan });
  const refresh = signRefresh({ sub: user.id, jti });
  const expiresAt = new Date(Date.now() + ms(env.REFRESH_TTL));
  await prisma.refreshToken.create({ data: { userId: user.id, tokenHash: await hash(refresh), family, expiresAt } });
  return { access, refresh, user, family };
}

export async function rotateRefresh(oldToken: string) {
  let payload;
  try { payload = verifyRefresh(oldToken); } catch { throw Unauthorized('Invalid refresh'); }
  const tokens = await prisma.refreshToken.findMany({ where: { userId: payload.sub, revokedAt: null } });
  let matched: any = null;
  for (const t of tokens) {
    if (await verifyHash(oldToken, t.tokenHash)) { matched = t; break; }
  }
  if (!matched) {
    // why: reuse detected - revoke the entire family to kick attackers out.
    await prisma.refreshToken.updateMany({ where: { userId: payload.sub }, data: { revokedAt: new Date() } });
    throw Unauthorized('Refresh reuse detected');
  }
  await prisma.refreshToken.update({ where: { id: matched.id }, data: { revokedAt: new Date() } });
  return issueTokens(payload.sub, matched.family);
}

export async function logoutByToken(oldToken: string) {
  try {
    const payload = verifyRefresh(oldToken);
    const tokens = await prisma.refreshToken.findMany({ where: { userId: payload.sub, revokedAt: null } });
    for (const t of tokens) {
      if (await verifyHash(oldToken, t.tokenHash)) {
        await prisma.refreshToken.update({ where: { id: t.id }, data: { revokedAt: new Date() } });
        break;
      }
    }
  } catch { /* silent */ }
}
