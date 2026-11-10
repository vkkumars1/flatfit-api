import { describe, it, expect } from 'vitest';
import request from 'supertest';

// why: lightweight self-contained check - no DB needed to assert the route exists.
describe('GET /health', () => {
  it('returns ok shape', async () => {
    const { buildApp } = await import('../src/app.js');
    const app = buildApp();
    const r = await request(app).get('/health');
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty('status', 'ok');
    expect(r.body).toHaveProperty('db');
    expect(r.body).toHaveProperty('time');
  });
});
