import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma.js';
import { stripHtml } from '../lib/sanitize.js';

export async function postReport(req: Request, res: Response, next: NextFunction) {
  try {
    const u = (req as any).user;
    const { targetUserId, reason, details } = req.body as any;
    const row = await prisma.report.create({ data: { reporterId: u.id, targetId: targetUserId, reason, details: stripHtml(details ?? '') } });
    res.json(row);
  } catch (e) { next(e); }
}

export async function listBlocks(req: Request, res: Response, next: NextFunction) {
  try {
    const u = (req as any).user;
    const items = await prisma.block.findMany({ where: { blockerId: u.id } });
    res.json({ items });
  } catch (e) { next(e); }
}

export async function postBlock(req: Request, res: Response, next: NextFunction) {
  try {
    const u = (req as any).user;
    const { targetUserId } = req.body as any;
    const row = await prisma.block.upsert({
      where: { blockerId_blockedId: { blockerId: u.id, blockedId: targetUserId } },
      update: {}, create: { blockerId: u.id, blockedId: targetUserId },
    });
    res.json(row);
  } catch (e) { next(e); }
}

export async function deleteBlock(req: Request, res: Response, next: NextFunction) {
  try {
    const u = (req as any).user;
    await prisma.block.deleteMany({ where: { blockerId: u.id, blockedId: req.params.userId! } });
    res.status(204).send();
  } catch (e) { next(e); }
}

export async function postSelfie(req: Request, res: Response, next: NextFunction) {
  try {
    const u = (req as any).user;
    const { path } = req.body as { path: string };
    const row = await prisma.verification.create({ data: { userId: u.id, type: 'SELFIE', status: 'PENDING', path } });
    res.json({ status: row.status });
  } catch (e) { next(e); }
}
