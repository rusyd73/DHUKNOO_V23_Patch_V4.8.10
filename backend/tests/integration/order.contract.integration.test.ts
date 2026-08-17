import request from 'supertest';
import { app } from '../../src/app';
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';

describe('Create-order API contract', () => {
  it('keeps POST /api/customer/orders unavailable and exposes POST /api/order', async () => {
    const legacy = await request(app).post('/api/customer/orders').send({});
    expect(legacy.status).toBe(404);

    // Route exists; authentication is reached before controller/validation.
    const canonical = await request(app).post('/api/order').send({});
    expect(canonical.status).toBe(401);
    // 🔥 PERBAIKAN: Sesuai pesan error dari kode produksi (auth.middleware.ts)
    expect(canonical.body.error).toMatch(/Akses ditolak. Token autentikasi kosong!|Token autentikasi kosong/i);
  });
});