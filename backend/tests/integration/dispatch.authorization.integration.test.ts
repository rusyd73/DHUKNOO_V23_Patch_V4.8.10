import './_teardown';
import request from 'supertest';
import { app } from '../../src/app';
import { prisma } from '../../src/config/prisma';

// 🆕 FIX P2 "Aktifkan test untuk ... dispatch authorization" (audit E.2),
// menguji perbaikan P1 #1 "Dispatch status authorization" -- GET
// /api/dispatch/:orderId/status SEBELUMNYA hanya dilindungi
// authenticateToken (siapa pun yang login bisa membaca status dispatch
// order MANA PUN). Sekarang harus customer pemilik order, driver yang
// ditugaskan, atau admin. Butuh Postgres nyala (sama seperti
// auth.integration.test.ts).

const suffix = Date.now();
const ownerEmail = `dispatch-owner-${suffix}@obamaride.test`;
const strangerEmail = `dispatch-stranger-${suffix}@obamaride.test`;
const driverEmail = `dispatch-driver-${suffix}@obamaride.test`;
const password = 'password123';

let ownerToken: string;
let strangerToken: string;
let driverToken: string;
let orderId: string;

async function registerAndLogin(email: string, fullName: string, role: 'CUSTOMER' | 'DRIVER') {
  const extra =
    role === 'DRIVER'
      ? { vehiclePlate: `TEST ${suffix}`, vehicleModel: 'Test Motor' }
      : {};
  await request(app).post('/api/auth/register').send({
    email,
    password,
    fullName,
    role,
    ...extra,
  });
  const loginRes = await request(app).post('/api/auth/login').send({ email, password });
  return loginRes.body.data.accessToken as string;
}

beforeAll(async () => {
  ownerToken = await registerAndLogin(ownerEmail, 'Pemilik Order Uji', 'CUSTOMER');
  strangerToken = await registerAndLogin(strangerEmail, 'Orang Asing Uji', 'CUSTOMER');
  driverToken = await registerAndLogin(driverEmail, 'Driver Uji', 'DRIVER');

  const ownerProfile = await prisma.customerProfile.findFirstOrThrow({ where: { user: { email: ownerEmail } } });
  const driverProfile = await prisma.driverProfile.findFirstOrThrow({ where: { user: { email: driverEmail } } });

  // Order dibuat langsung lewat Prisma (bukan lewat POST /api/orders) supaya
  // test ini fokus murni ke authorization endpoint status, tanpa bergantung
  // pada alur dispatch/matching driver yang jauh lebih kompleks.
  const order = await prisma.order.create({
    data: {
      serviceType: 'BIKE',
      status: 'ACCEPTED',
      price: 15000,
      pickupAddress: 'Titik Jemput Uji',
      pickupLat: -7.9,
      pickupLng: 112.6,
      dropoffAddress: 'Titik Antar Uji',
      dropoffLat: -7.91,
      dropoffLng: 112.61,
      customerId: ownerProfile.id,
      driverId: driverProfile.id,
    },
  });
  orderId = order.id;
});

afterAll(async () => {
  await prisma.order.deleteMany({ where: { id: orderId } });
  await prisma.user.deleteMany({ where: { email: { in: [ownerEmail, strangerEmail, driverEmail] } } });
  await prisma.$disconnect();
});

describe('GET /api/dispatch/:orderId/status (authorization)', () => {
  it('menolak akses tanpa token', async () => {
    const res = await request(app).get(`/api/dispatch/${orderId}/status`);
    expect(res.status).toBe(401);
  });

  it('mengizinkan customer pemilik order', async () => {
    const res = await request(app)
      .get(`/api/dispatch/${orderId}/status`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.orderId).toBe(orderId);
  });

  it('mengizinkan driver yang ditugaskan ke order', async () => {
    const res = await request(app)
      .get(`/api/dispatch/${orderId}/status`)
      .set('Authorization', `Bearer ${driverToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.orderId).toBe(orderId);
  });

  it('menolak customer LAIN yang tidak terlibat di order ini', async () => {
    const res = await request(app)
      .get(`/api/dispatch/${orderId}/status`)
      .set('Authorization', `Bearer ${strangerToken}`);

    expect(res.status).toBe(403);
  });
});
