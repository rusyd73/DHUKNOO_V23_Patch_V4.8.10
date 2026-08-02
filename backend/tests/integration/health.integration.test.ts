import request from 'supertest';
import { app } from '../../src/app';

// Test ini menghidupkan `app` Express asli (lihat src/app.ts) tanpa membuka port
// jaringan sungguhan — supertest cukup memanggilnya langsung secara in-memory.
describe('GET /health', () => {
  it('mengembalikan status 200 (UP) atau 503 (DOWN) dengan bentuk body yang benar', async () => {
    const res = await request(app).get('/health');

    expect([200, 503]).toContain(res.status);
    expect(res.body).toHaveProperty('status');
    expect(res.body).toHaveProperty('services.database.status');
    expect(res.body).toHaveProperty('services.redis.status');
    expect(res.body).toHaveProperty('services.system.uptime');
  });
});

describe('GET /', () => {
  it('menyapa dengan pesan selamat datang', async () => {
    const res = await request(app).get('/');

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/OBAMA/i);
  });
});

describe('GET /metrics', () => {
  it('mengembalikan metrik format Prometheus (text)', async () => {
    const res = await request(app).get('/metrics');

    expect(res.status).toBe(200);
    expect(res.text).toEqual(expect.any(String));
  });
});
