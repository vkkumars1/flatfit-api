import { describe, it, expect } from 'vitest';
import request from 'supertest';

describe('auth route shapes', () => {
  it('rejects invalid phone', async () => {
    const { buildApp } = await import('../src/app.js');
    const app = buildApp();
    const r = await request(app).post('/auth/send-otp').send({ phone: 'not-a-phone' });
    expect(r.status).toBe(400);
    expect(r.body?.error?.code).toBe('VALIDATION_ERROR');
  });

  it('rejects unauth on /me', async () => {
    const { buildApp } = await import('../src/app.js');
    const app = buildApp();
    const r = await request(app).get('/me');
    expect(r.status).toBe(401);
  });
});
