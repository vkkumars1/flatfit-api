import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma.js';
import { supabase } from '../lib/supabase.js';
import { env } from '../config/env.js';
import { NotFound } from '../lib/errors.js';

export async function listPendingVerifications(req: Request, res: Response, next: NextFunction) {
  try {
    const cursor = req.query.cursor as string | undefined;
    const items = await prisma.verification.findMany({
      where: { type: 'SELFIE', status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
      take: 20,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    const withUrls = await Promise.all(items.map(async (v) => {
      let signed: string | null = null;
      if (v.path) {
        try {
          const { data } = await supabase().storage.from(env.SUPABASE_PRIVATE_BUCKET).createSignedUrl(v.path, 60);
          signed = data?.signedUrl ?? null;
        } catch { signed = null; }
      }
      return { id: v.id, userId: v.userId, status: v.status, signedUrl: signed };
    }));
    const nextCursor = items.length === 20 ? items[items.length - 1]?.id : null;
    res.json({ items: withUrls, nextCursor });
  } catch (e) { next(e); }
}

export async function reviewVerification(req: Request, res: Response, next: NextFunction) {
  try {
    const u = (req as any).user;
    const { status } = req.body as { status: 'approved' | 'rejected' };
    const v = await prisma.verification.findUnique({ where: { id: req.params.id! } });
    if (!v) throw NotFound('Verification not found');
    const updated = await prisma.verification.update({
      where: { id: v.id },
      data: { status: status === 'approved' ? 'VERIFIED' : 'REJECTED', reviewedBy: u.id },
    });
    res.json(updated);
  } catch (e) { next(e); }
}
