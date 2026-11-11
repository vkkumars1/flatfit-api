import type { Request, Response, NextFunction } from 'express';
import { sendOtp, verifyOtp } from '../services/otp.js';
import { issueTokens, rotateRefresh, logoutByToken } from '../services/auth.js';
import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';
import ms from '../services/ms.js';
import { Unauthorized } from '../lib/errors.js';
import { getFirebaseAuth } from '../lib/firebase.js';

const cookieOpts = () => ({
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: (env.NODE_ENV === 'production' ? 'none' : 'lax') as 'none' | 'lax',
  path: '/auth',
  maxAge: ms(env.REFRESH_TTL),
});

export async function postSendOtp(req: Request, res: Response, next: NextFunction) {
  try {
    const { phone } = req.body as { phone: string };
    const r = await sendOtp(phone);
    res.json({ ok: true, ...r });
  } catch (e) { next(e); }
}

export async function postVerifyOtp(req: Request, res: Response, next: NextFunction) {
  try {
    const { phone, otp } = req.body as { phone: string; otp: string };
    await verifyOtp(phone, otp);
    let user = await prisma.user.findUnique({ where: { phone } });
    let isNewUser = false;
    if (!user) {
      isNewUser = true;
      user = await prisma.user.create({ data: { phone, name: 'New user', gender: 'unspecified', dob: new Date('2000-01-01') } });
    }
    const { access, refresh } = await issueTokens(user.id);
    res.cookie('rt', refresh, cookieOpts());
    res.json({ accessToken: access, user: { id: user.id, name: user.name, role: user.role, plan: user.plan }, isNewUser });
  } catch (e) { next(e); }
}

export async function postRefresh(req: Request, res: Response, next: NextFunction) {
  try {
    const rt = req.cookies?.rt;
    if (!rt) throw Unauthorized('Missing refresh cookie');
    const { access, refresh, user } = await rotateRefresh(rt);
    res.cookie('rt', refresh, cookieOpts());
    res.json({ accessToken: access, user: { id: user.id, name: user.name, role: user.role, plan: user.plan } });
  } catch (e) { next(e); }
}

export async function postLogout(req: Request, res: Response, next: NextFunction) {
  try {
    const rt = req.cookies?.rt;
    if (rt) await logoutByToken(rt);
    res.clearCookie('rt', { path: '/auth' });
    res.status(204).send();
  } catch (e) { next(e); }
}

export async function postFirebaseVerify(req: Request, res: Response, next: NextFunction) {
  try {
    const { idToken } = req.body as { idToken: string };
    const auth = getFirebaseAuth();
    if (!auth) throw Unauthorized('Firebase not configured');
    let decoded;
    try {
      decoded = await auth.verifyIdToken(idToken);
    } catch {
      throw Unauthorized('Invalid Firebase token');
    }
    const phone = decoded.phone_number;
    const email = decoded.email;
    const firebaseUid = decoded.uid;
    let identityKey: string;
    let seedName = (decoded.name as string | undefined) ?? 'New user';
    if (phone) {
      identityKey = phone;
    } else if (email && firebaseUid) {
      identityKey = `google:${firebaseUid}`;
    } else {
      throw Unauthorized('Firebase token has no phone or email');
    }
    let user = await prisma.user.findUnique({ where: { phone: identityKey } });
    let isNewUser = false;
    if (!user) {
      isNewUser = true;
      user = await prisma.user.create({ data: { phone: identityKey, email: email ?? null, name: seedName, gender: 'unspecified', dob: new Date('2000-01-01') } });
    } else if (email && !user.email) {
      user = await prisma.user.update({ where: { id: user.id }, data: { email } });
    }
    const { access, refresh } = await issueTokens(user.id);
    res.cookie('rt', refresh, cookieOpts());
    res.json({ accessToken: access, user: { id: user.id, name: user.name, role: user.role, plan: user.plan }, isNewUser });
  } catch (e) { next(e); }
}
