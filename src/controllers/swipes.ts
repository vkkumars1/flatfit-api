import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma.js';
import { cache } from '../lib/cache.js';
import { computeScore } from '../services/matching.js';
import { emitMatchEvent } from '../sockets/index.js';

export async function postSwipe(req: Request, res: Response, next: NextFunction) {
  try {
    const u = (req as any).user;
    const { toUserId, action } = req.body as { toUserId: string; action: 'LIKE'|'PASS'|'SUPER' };

    // why: wrap swipe + match creation in a tx so we never produce a half match.
    const result = await prisma.$transaction(async (tx) => {
      await tx.swipe.upsert({
        where: { fromUser_toUser: { fromUser: u.id, toUser: toUserId } },
        update: { action },
        create: { fromUser: u.id, toUser: toUserId, action },
      });
      let matched = false, matchId: string | null = null;
      if (action !== 'PASS') {
        const other = await tx.swipe.findUnique({ where: { fromUser_toUser: { fromUser: toUserId, toUser: u.id } } });
        if (other && other.action !== 'PASS') {
          const [userA, userB] = u.id < toUserId ? [u.id, toUserId] : [toUserId, u.id];
          const me = await tx.user.findUnique({ where: { id: u.id }, include: { profile: true, lifestyle: true } });
          const them = await tx.user.findUnique({ where: { id: toUserId }, include: { profile: true, lifestyle: true } });
          let score = 70;
          if (me?.profile && me.lifestyle && them?.profile && them.lifestyle) {
            score = computeScore(
              { ...me.lifestyle, city: me.profile.city, budgetMin: me.profile.budgetMin, budgetMax: me.profile.budgetMax } as any,
              { ...them.lifestyle, city: them.profile.city, budgetMin: them.profile.budgetMin, budgetMax: them.profile.budgetMax } as any,
            ).score;
          }
          const match = await tx.match.upsert({
            where: { userA_userB: { userA, userB } },
            update: {},
            create: { userA, userB, score },
          });
          matched = true; matchId = match.id;
        }
      }
      return { matched, matchId };
    });

    // Invalidate discover cache for this user.
    for (const k of cache.keys()) if (k.startsWith(`discover:${u.id}:`)) cache.del(k);

    if (result.matched && result.matchId) emitMatchEvent(u.id, toUserId, result.matchId);
    res.json(result);
  } catch (e) { next(e); }
}
