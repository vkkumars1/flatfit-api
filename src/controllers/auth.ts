import type { Request, Response, NextFunction } from 'express';
import { sendOtp, verifyOtp } from '../services/otp.js';
import { issueTokens, rotateRefresh, logoutByToken } from '../services/auth.js';
import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';
import ms from '../services/ms.js';
import { Unauthorized, BadRequest } from '../lib/errors.js';
import { getFirebaseAuth } from '../lib/firebase.js';
import bcrypt from 'bcryptjs';

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

// why: pure-DB email+password signup, no Firebase dep, issues same JWT access + refresh cookie.
export async function postEmailSignup(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, password, name } = req.body as { email: string; password: string; name?: string };
    const normEmail = email.toLowerCase().trim();
    const existing = await prisma.user.findUnique({ where: { email: normEmail } });
    if (existing) throw BadRequest('Email already registered — sign in instead');
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: {
        phone: `email:${normEmail}`,
        email: normEmail,
        password: passwordHash,
        name: (name && name.trim()) || 'New user',
        gender: 'unspecified',
        dob: new Date('2000-01-01'),
      },
    });
    const { access, refresh } = await issueTokens(user.id);
    res.cookie('rt', refresh, cookieOpts());
    res.json({ accessToken: access, user: { id: user.id, name: user.name, role: user.role, plan: user.plan }, isNewUser: true });
  } catch (e) { next(e); }
}

// why: pure-DB email+password signin, bcrypt timingSafe compare against stored hash.
export async function postEmailSignin(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, password } = req.body as { email: string; password: string };
    const normEmail = email.toLowerCase().trim();
    const user = await prisma.user.findUnique({ where: { email: normEmail } });
    if (!user || !user.password) throw Unauthorized('Invalid email or password');
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) throw Unauthorized('Invalid email or password');
    const { access, refresh } = await issueTokens(user.id);
    res.cookie('rt', refresh, cookieOpts());
    res.json({ accessToken: access, user: { id: user.id, name: user.name, role: user.role, plan: user.plan }, isNewUser: false });
  } catch (e) { next(e); }
}
