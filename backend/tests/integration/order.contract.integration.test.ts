import './_teardown';
import request from 'supertest';
import { app } from '../../src/app';

describe('Create-order API contract', () => {
  it('keeps POST /api/customer/orders unavailable and exposes POST /api/order', async () => {
    const legacy = await request(app).post('/api/customer/orders').send({});
    expect(legacy.status).toBe(404);

    // Route exists; authentication is reached before controller/validation.
    const canonical = await request(app).post('/api/order').send({});
    expect(canonical.status).toBe(401);
    expect(canonical.body.error).toMatch(/Token autentikasi kosong/i);
  });
});
