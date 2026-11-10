import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma.js';
import { getUserFull } from '../repositories/user.js';
import { stripHtml } from '../lib/sanitize.js';
import { supabase, ALLOWED_MIME, MAX_UPLOAD_BYTES } from '../lib/supabase.js';
import { env } from '../config/env.js';
import { randomUUID } from 'node:crypto';
import { BadRequest } from '../lib/errors.js';

export async function getMe(req: Request, res: Response, next: NextFunction) {
  try {
    const u = (req as any).user;
    const full = await getUserFull(u.id);
    if (!full) throw BadRequest('User missing');
    const v = (type: string) => full.verifications.find((x) => x.type === type)?.status ?? 'NONE';
    res.json({
      user: { id: full.id, name: full.name, phone: full.phone, email: full.email, role: full.role, plan: full.plan, gender: full.gender, dob: full.dob },
      profile: full.profile ?? null,
      lifestyle: full.lifestyle ?? null,
      dealBreakers: full.dealBreakers.map(({ key, value }) => ({ key, value })),
      verification: { phone: v('PHONE'), email: v('EMAIL'), selfie: v('SELFIE') },
      plan: full.plan,
    });
  } catch (e) { next(e); }
}

export async function putProfile(req: Request, res: Response, next: NextFunction) {
  try {
    const u = (req as any).user;
    const body = req.body as any;
    // Ownership check on every photo path.
    for (const p of body.photos ?? []) {
      if (!String(p).includes(`/${u.id}/`)) throw BadRequest('Photo path must be in your folder');
    }
    const data = {
      bio: stripHtml(body.bio ?? ''),
      city: body.city, budgetMin: body.budgetMin, budgetMax: body.budgetMax,
      moveInDate: new Date(body.moveInDate),
      occupation: body.occupation, mode: body.mode, photos: body.photos ?? [],
    };
    await prisma.user.update({ where: { id: u.id }, data: { name: body.name, gender: body.gender, dob: new Date(body.dob) } });
    await prisma.profile.upsert({ where: { userId: u.id }, update: data, create: { userId: u.id, ...data } });
    res.json({ ok: true });
  } catch (e) { next(e); }
}

export async function putLifestyle(req: Request, res: Response, next: NextFunction) {
  try {
    const u = (req as any).user;
    const data = req.body;
    await prisma.lifestyle.upsert({ where: { userId: u.id }, update: data, create: { userId: u.id, ...data } });
    res.json({ ok: true });
  } catch (e) { next(e); }
}

export async function putDealBreakers(req: Request, res: Response, next: NextFunction) {
  try {
    const u = (req as any).user;
    const list = req.body as { key: string; value: string }[];
    await prisma.$transaction([
      prisma.dealBreaker.deleteMany({ where: { userId: u.id } }),
      prisma.dealBreaker.createMany({ data: list.map((d) => ({ userId: u.id, key: d.key, value: d.value })) }),
    ]);
    res.json({ ok: true });
  } catch (e) { next(e); }
}

export async function postUploadUrl(req: Request, res: Response, next: NextFunction) {
  try {
    const u = (req as any).user;
    const { fileType, fileSize, purpose } = req.body as { fileType: string; fileSize: number; purpose: 'profile'|'selfie'|'listing' };
    if (!ALLOWED_MIME.includes(fileType)) throw BadRequest('Unsupported file type');
    if (fileSize > MAX_UPLOAD_BYTES) throw BadRequest('File too large');
    const ext = fileType.split('/')[1] ?? 'bin';
    const bucket = purpose === 'selfie' ? env.SUPABASE_PRIVATE_BUCKET : env.SUPABASE_BUCKET;
    const path = `${purpose}/${u.id}/${randomUUID()}.${ext}`;
    const { data, error } = await supabase().storage.from(bucket).createSignedUploadUrl(path);
    if (error || !data) throw BadRequest('Failed to create upload url');
    const publicUrl = purpose === 'selfie' ? '' : supabase().storage.from(bucket).getPublicUrl(path).data.publicUrl;
    res.json({ uploadUrl: data.signedUrl, path, publicUrl });
  } catch (e) { next(e); }
}
