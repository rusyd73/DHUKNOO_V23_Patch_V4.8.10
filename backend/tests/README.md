# Test Suite — Backend OBAMA

## Struktur
- `tests/unit/` — test murni logic, **tidak butuh database**. Bisa dijalankan di mana saja.
  - `promo.calc.test.ts` — perhitungan diskon promo (PERCENTAGE/FIXED, maxDiscount, kuota, kedaluwarsa).
  - `payment.split.test.ts` — pembagian pembayaran order (potongan komisi platform vs pendapatan driver).
- `tests/integration/` — test lewat HTTP request sungguhan (supertest) ke `src/app.ts`.
  - `health.integration.test.ts` — tidak butuh DB (menangani status UP maupun DOWN dengan baik).
  - `auth.integration.test.ts` — **butuh Postgres nyala**, karena benar-benar mendaftarkan & login user.

## Menjalankan Test

### Unit test saja (paling cepat, tidak butuh setup apa pun)
```bash
cd backend
npx jest tests/unit --runInBand
```

### Seluruh test (unit + integration)
Pastikan Postgres sudah nyala dan schema sudah ter-apply:
```bash
docker compose up -d postgres redis
cd backend
cp ../.env.example ../.env   # kalau belum ada
npx prisma generate
npx prisma db push
npm test
```

## Di CI
Kedua workflow (`deploy.yml` dan `deploy-staging.yml`) sudah otomatis menyediakan
service container Postgres + Redis dan menjalankan `npm test` sebagai bagian dari
pipeline — tidak perlu setup manual apa pun di GitHub Actions.

## Menambah test baru
- Logic murni (kalkulasi, validasi, dsb) → taruh di `tests/unit/`, mock semua
  dependency yang menyentuh database (lihat contoh `jest.mock(...)` di `promo.calc.test.ts`).
- Alur HTTP end-to-end → taruh di `tests/integration/`, import `app` dari
  `src/app.ts` (BUKAN `src/server.ts`, karena itu akan benar-benar membuka port).
