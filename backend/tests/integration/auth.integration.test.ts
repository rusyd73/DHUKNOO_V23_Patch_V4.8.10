import './_teardown';
import request from 'supertest';
import { app } from '../../src/app';
import { prisma } from '../../src/config/prisma';

// Test ini BUTUH Postgres nyala (lihat DATABASE_URL di tests/setupEnv.ts atau .env).
// 🆕 FIX P2 "README/dokumentasi jangan merujuk struktur yang tidak sesuai"
// (audit E.5): komentar ini SEBELUMNYA merujuk .github/workflows/deploy.yml
// (job audit-backend) dan deploy-staging.yml (job build-and-test) -- KEDUA
// FILE ITU TIDAK PERNAH ADA di repo ini, jadi klaim "sudah otomatis
// disediakan di CI" itu tidak benar. CI yang benar-benar ada sekarang
// ada di .github/workflows/ci.yml (job "backend"), yang memang sudah
// menyediakan Postgres lewat service container persis seperti yang
// coba dijelaskan komentar lama ini. Untuk jalan di lokal: `docker
// compose up -d postgres` lalu `npx prisma db push` sebelum `npm test`.

const testEmail = `test-auth-${Date.now()}@obamaride.test`;
const testPassword = 'password123';

afterAll(async () => {
  // Bersihkan user uji coba agar test bisa diulang tanpa bentrok "email sudah terdaftar"
  await prisma.user.deleteMany({ where: { email: testEmail } });
  await prisma.$disconnect();
});

describe('POST /api/auth/register', () => {
  it('berhasil mendaftarkan customer baru', async () => {
    const res = await request(app).post('/api/auth/register').send({
      email: testEmail,
      password: testPassword,
      fullName: 'Budi Uji Coba',
      role: 'CUSTOMER',
    });

    // 🆕 FIX P0 KONTRAK AUTH: backend membungkus payload sukses di
    // `data` (lihat auth.controller.ts register -> { success, message,
    // data: result }) -- kontrak final yang sama dipakai modul lain
    // (merchant, dst). Sebelumnya test ini mengecek field di level
    // teratas (res.body.user), yang tidak pernah ada di response asli.
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ email: testEmail, role: 'CUSTOMER' });
    expect(res.body.data.id).toEqual(expect.any(String));
  });

  it('menolak registrasi dengan email yang sudah terdaftar', async () => {
    const res = await request(app).post('/api/auth/register').send({
      email: testEmail,
      password: testPassword,
      fullName: 'Budi Duplikat',
      role: 'CUSTOMER',
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/sudah terdaftar/);
  });

  it('menolak registrasi dengan input tidak valid (email salah format)', async () => {
    const res = await request(app).post('/api/auth/register').send({
      email: 'bukan-email',
      password: testPassword,
      fullName: 'Budi',
      role: 'CUSTOMER',
    });

    expect(res.status).toBe(400);
  });

  it('menolak registrasi role MERCHANT tanpa data toko', async () => {
    const res = await request(app).post('/api/auth/register').send({
      email: `merchant-${Date.now()}@obamaride.test`,
      password: testPassword,
      fullName: 'Pemilik Toko',
      role: 'MERCHANT',
      // sengaja tidak menyertakan merchantName/merchantCategory/dst.
    });

    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/login', () => {
  it('berhasil login dengan kredensial yang benar dan mengembalikan token JWT', async () => {
    const res = await request(app).post('/api/auth/login').send({
      email: testEmail,
      password: testPassword,
    });

    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    expect(res.body.data.refreshToken).toEqual(expect.any(String));
    expect(res.body.data.user).toMatchObject({ email: testEmail, role: 'CUSTOMER' });
  });

  it('menolak login dengan password salah', async () => {
    const res = await request(app).post('/api/auth/login').send({
      email: testEmail,
      password: 'password-yang-salah',
    });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Password salah/);
  });

  it('menolak login untuk email yang tidak terdaftar', async () => {
    const res = await request(app).post('/api/auth/login').send({
      email: `tidak-ada-${Date.now()}@obamaride.test`,
      password: testPassword,
    });

    expect(res.status).toBe(404);
  });
});

describe('GET /api/auth/profile (RBAC)', () => {
  it('menolak akses tanpa token', async () => {
    const res = await request(app).get('/api/auth/profile');
    expect(res.status).toBe(401);
  });

  it('mengizinkan akses dengan token yang valid', async () => {
    const loginRes = await request(app).post('/api/auth/login').send({
      email: testEmail,
      password: testPassword,
    });

    const res = await request(app)
      .get('/api/auth/profile')
      .set('Authorization', `Bearer ${loginRes.body.data.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe(testEmail);
  });
});
