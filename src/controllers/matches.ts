import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma.js';
import { computeScore, reasons } from '../services/matching.js';
import { stripHtml } from '../lib/sanitize.js';
import { NotFound } from '../lib/errors.js';
import { emitMessage } from '../sockets/index.js';

async function assertMember(matchId: string, userId: string) {
  const m = await prisma.match.findUnique({ where: { id: matchId } });
  if (!m || (m.userA !== userId && m.userB !== userId)) throw NotFound('Match not found');
  return m;
}

export async function listMatches(req: Request, res: Response, next: NextFunction) {
  try {
    const u = (req as any).user;
    const matches = await prisma.match.findMany({
      where: { OR: [{ userA: u.id }, { userB: u.id }] },
      orderBy: { createdAt: 'desc' },
      include: { messages: { orderBy: { createdAt: 'desc' }, take: 1 } },
      take: 50,
    });
    const items = await Promise.all(matches.map(async (m) => {
      const otherId = m.userA === u.id ? m.userB : m.userA;
      const other = await prisma.user.findUnique({ where: { id: otherId }, include: { profile: true } });
      const unread = await prisma.message.count({ where: { matchId: m.id, senderId: otherId, readAt: null } });
      return {
        matchId: m.id,
        otherUser: {
          id: other?.id, name: other?.name, age: other?.dob ? Math.floor((Date.now() - new Date(other.dob).getTime()) / (365.25*86400000)) : null,
          city: other?.profile?.city, occupation: other?.profile?.occupation, avatar: other?.profile?.photos?.[0] ?? null,
        },
        score: m.score,
        lastMessage: m.messages[0] ?? null,
        unreadCount: unread,
      };
    }));
    res.json({ items, nextCursor: null });
  } catch (e) { next(e); }
}

export async function getCompatibility(req: Request, res: Response, next: NextFunction) {
  try {
    const u = (req as any).user;
    const match = await assertMember(req.params.id!, u.id);
    const [a, b] = await Promise.all([
      prisma.user.findUnique({ where: { id: match.userA }, include: { profile: true, lifestyle: true } }),
      prisma.user.findUnique({ where: { id: match.userB }, include: { profile: true, lifestyle: true } }),
    ]);
    if (!a?.profile || !a.lifestyle || !b?.profile || !b.lifestyle) throw NotFound('Profiles incomplete');
    const x = { ...a.lifestyle, city: a.profile.city, budgetMin: a.profile.budgetMin, budgetMax: a.profile.budgetMax };
    const y = { ...b.lifestyle, city: b.profile.city, budgetMin: b.profile.budgetMin, budgetMax: b.profile.budgetMax };
    const { score, breakdown } = computeScore(x as any, y as any);
    const r = reasons(breakdown);
    res.json({ score, breakdown, reasons: { good: r.good, bad: r.bad } });
  } catch (e) { next(e); }
}

export async function listMessages(req: Request, res: Response, next: NextFunction) {
  try {
    const u = (req as any).user;
    await assertMember(req.params.id!, u.id);
    const cursor = req.query.cursor as string | undefined;
    const items = await prisma.message.findMany({
      where: { matchId: req.params.id! },
      orderBy: { createdAt: 'desc' },
      take: 20,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    const nextCursor = items.length === 20 ? items[items.length - 1]?.id : null;
    res.json({ items: items.reverse(), nextCursor });
  } catch (e) { next(e); }
}

export async function postMessage(req: Request, res: Response, next: NextFunction) {
  try {
    const u = (req as any).user;
    const match = await assertMember(req.params.id!, u.id);
    const text = stripHtml(String((req.body as any).text)).slice(0, 1000);
    const msg = await prisma.message.create({ data: { matchId: match.id, senderId: u.id, text } });
    const otherId = match.userA === u.id ? match.userB : match.userA;
    emitMessage(otherId, msg);
    res.json(msg);
  } catch (e) { next(e); }
}
