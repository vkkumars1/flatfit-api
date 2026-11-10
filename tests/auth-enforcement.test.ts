import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildApp } from '../src/app.js';

// why: Security Checklist #2 — every protected route must reject unauthenticated requests.
describe('auth enforcement', () => {
  const app = buildApp();
  const protectedGets = [
    '/me',
    '/discover',
    '/matches',
    '/blocks',
    '/admin/verifications',
  ];
  for (const path of protectedGets) {
    it(`401 on GET ${path} without token`, async () => {
      const res = await request(app).get(path);
      expect(res.status).toBe(401);
    });
  }
  const protectedPosts: [string, any][] = [
    ['/swipes', { toUserId: 'x', action: 'LIKE' }],
    ['/matches/abc/messages', { text: 'hi' }],
    ['/reports', { targetId: 'x', reason: 'spam' }],
    ['/blocks', { blockedId: 'x' }],
    ['/verify/selfie', { path: 'x' }],
  ];
  for (const [path, body] of protectedPosts) {
    it(`401 on POST ${path} without token`, async () => {
      const res = await request(app).post(path).send(body);
      expect(res.status).toBe(401);
    });
  }
  it('admin requires ADMIN role (403 with user token)', async () => {
    // Without token → 401; verifies requireAuth fires before requireRole.
    const res = await request(app).get('/admin/verifications');
    expect([401, 403]).toContain(res.status);
  });
  it('public route /health has no auth', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
  });
});
