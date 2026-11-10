import { prisma } from '../lib/prisma.js';

// why: a single query grabs every piece the matching engine needs.
export async function loadCandidatePool(userId: string, city?: string) {
  const [me, blocks, blockedBy, swipes] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, include: { profile: true, lifestyle: true, dealBreakers: true } }),
    prisma.block.findMany({ where: { blockerId: userId }, select: { blockedId: true } }),
    prisma.block.findMany({ where: { blockedId: userId }, select: { blockerId: true } }),
    prisma.swipe.findMany({ where: { fromUser: userId }, select: { toUser: true } }),
  ]);
  if (!me || !me.profile || !me.lifestyle) return { me: null, candidates: [] as any[] };

  const excluded = new Set<string>([userId, ...blocks.map((b) => b.blockedId), ...blockedBy.map((b) => b.blockerId), ...swipes.map((s) => s.toUser)]);

  const candidates = await prisma.user.findMany({
    where: {
      id: { notIn: Array.from(excluded) },
      profile: { city: city ?? me.profile.city },
    },
    include: { profile: true, lifestyle: true, dealBreakers: true },
    take: 200,
  });

  return { me, candidates };
}
