import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma.js';
import { NotFound } from '../lib/errors.js';

async function assertMember(matchId: string, userId: string) {
  const m = await prisma.match.findUnique({ where: { id: matchId } });
  if (!m || (m.userA !== userId && m.userB !== userId)) throw NotFound('Match not found');
  return m;
}

export async function getAgreement(req: Request, res: Response, next: NextFunction) {
  try {
    const u = (req as any).user;
    const match = await assertMember(req.params.id!, u.id);
    const a = await prisma.agreement.findUnique({ where: { matchId: match.id } });
    res.json(a ?? null);
  } catch (e) { next(e); }
}

export async function upsertAgreement(req: Request, res: Response, next: NextFunction) {
  try {
    const u = (req as any).user;
    const match = await assertMember(req.params.id!, u.id);
    const { rules } = req.body as any;
    const a = await prisma.agreement.upsert({
      where: { matchId: match.id },
      update: { rules, acceptedByA: false, acceptedByB: false }, // why: edits reset acceptance so nobody is bound to new rules silently.
      create: { matchId: match.id, rules },
    });
    res.json(a);
  } catch (e) { next(e); }
}

export async function acceptAgreement(req: Request, res: Response, next: NextFunction) {
  try {
    const u = (req as any).user;
    const a = await prisma.agreement.findUnique({ where: { id: req.params.id! }, include: { match: true } });
    if (!a) throw NotFound('Agreement not found');
    const match = a.match;
    if (match.userA !== u.id && match.userB !== u.id) throw NotFound('Agreement not found');
    const patch: any = match.userA === u.id ? { acceptedByA: true } : { acceptedByB: true };
    const out = await prisma.agreement.update({ where: { id: a.id }, data: patch });
    res.json(out);
  } catch (e) { next(e); }
}
