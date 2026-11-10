import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';
import { BadRequest, Forbidden } from '../lib/errors.js';
import { PLAN_PRICES, isMockMode, getRazorpay, verifyWebhookSignature } from '../services/payments.js';
import { randomUUID } from 'node:crypto';

export async function createOrder(req: Request, res: Response, next: NextFunction) {
  try {
    const u = (req as any).user;
    const { plan } = req.body as { plan: 'VERIFIED' | 'BOOST' };
    const amount = PLAN_PRICES[plan];

    if (isMockMode()) {
      const orderId = `mock_${randomUUID()}`;
      await prisma.payment.create({ data: { userId: u.id, plan, amount, razorpayOrderId: orderId } });
      res.json({ orderId, amount, keyId: 'mock', mock: true });
      return;
    }

    const r = await getRazorpay();
    const order = await r.orders.create({ amount, currency: 'INR', notes: { userId: u.id, plan } });
    await prisma.payment.create({ data: { userId: u.id, plan, amount, razorpayOrderId: order.id } });
    res.json({ orderId: order.id, amount, keyId: env.RAZORPAY_KEY_ID });
  } catch (e) { next(e); }
}

export async function webhook(req: Request, res: Response, next: NextFunction) {
  try {
    const sig = req.headers['x-razorpay-signature'] as string | undefined;
    if (!sig) throw BadRequest('Missing signature');
    const raw = (req as any).rawBody ?? Buffer.alloc(0);
    if (!verifyWebhookSignature(raw, sig)) throw BadRequest('Bad signature');
    const body = JSON.parse(raw.toString('utf8'));
    if (body.event === 'payment.captured') {
      const payment = body.payload.payment.entity;
      const orderId = payment.order_id;
      const row = await prisma.payment.findUnique({ where: { razorpayOrderId: orderId } });
      if (row && row.status !== 'PAID') {
        await prisma.$transaction([
          prisma.payment.update({ where: { id: row.id }, data: { status: 'PAID', razorpayPaymentId: payment.id } }),
          prisma.user.update({ where: { id: row.userId }, data: { plan: row.plan } }),
        ]);
      }
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
}

export async function mockConfirm(req: Request, res: Response, next: NextFunction) {
  try {
    if (!env.DEMO_MODE || !isMockMode()) throw Forbidden('Mock confirm disabled');
    const u = (req as any).user;
    const { orderId } = req.body as { orderId: string };
    const row = await prisma.payment.findUnique({ where: { razorpayOrderId: orderId } });
    if (!row || row.userId !== u.id) throw BadRequest('Order not found');
    await prisma.$transaction([
      prisma.payment.update({ where: { id: row.id }, data: { status: 'PAID', razorpayPaymentId: `mockp_${Date.now()}` } }),
      prisma.user.update({ where: { id: u.id }, data: { plan: row.plan } }),
    ]);
    res.json({ ok: true, plan: row.plan });
  } catch (e) { next(e); }
}
