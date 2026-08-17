# Test Suite — Backend DHUKNOO

## Struktur
- `tests/unit/` — test murni logic, **tidak butuh database**. Bisa dijalankan di mana saja.
  - `promo.calc.test.ts` — perhitungan diskon promo (PERCENTAGE/FIXED, maxDiscount, kuota, kedaluwarsa).
  - `payment.split.test.ts` — pembagian pembayaran order (potongan komisi platform vs pendapatan driver).
  - `payment.mart-split.test.ts` — pembagian pembayaran khusus order MART (marketplace/merchant).
  - `tariff.commission.test.ts` — perhitungan tarif & komisi platform.
- `tests/integration/` — test lewat HTTP request sungguhan (supertest) ke `src/app.ts`.
  - `health.integration.test.ts` — tidak butuh DB (menangani status UP maupun DOWN dengan baik).
  - `auth.integration.test.ts` — **butuh Postgres nyala**: register, login, refresh contract, /profile RBAC.
  - `dispatch.authorization.integration.test.ts` — **butuh Postgres nyala**: memastikan status dispatch
    order hanya bisa dilihat customer pemilik order / driver yang ditugaskan / admin.

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
cp .env.example .env   # kalau belum ada
npx prisma generate
npx prisma db push
npm test
```

## Di CI
Workflow `.github/workflows/ci.yml` (job `backend`) menyediakan service container
Postgres dan menjalankan `npm run prisma:generate` → `prisma validate` →
`prisma migrate deploy` → typecheck → lint → unit test → integration test →
build, secara berurutan pada setiap push/PR — tidak perlu setup manual apa pun
di GitHub Actions. (Sebelumnya komentar di file ini merujuk `deploy.yml` dan
`deploy-staging.yml` yang tidak pernah benar-benar ada di repo — sudah diperbaiki.)

## Menambah test baru
- Logic murni (kalkulasi, validasi, dsb) → taruh di `tests/unit/`, mock semua
  dependency yang menyentuh database (lihat contoh `jest.mock(...)` di `promo.calc.test.ts`).
- Alur HTTP end-to-end → taruh di `tests/integration/`, import `app` dari
  `src/app.ts` (BUKAN `src/server.ts`, karena itu akan benar-benar membuka port).

## Yang masih perlu ditambahkan (belum ada test-nya sama sekali)
Sesuai audit (bagian E.2), area berikut masih butuh integration/unit test dan
belum tercakup: refresh token rotation, logout (pencabutan refresh token),
order lifecycle penuh (create → dispatch → accept → start → complete →
cancel), payment settlement atomicity, **wallet admin credit idempotency**
(lihat fix P0 #8 di `wallet.admin.service.ts` — paling prioritas untuk
ditest berikutnya karena ini operasi finansial retry-sensitive), dan ledger
immutability/batch atomicity (fix P0 #7 di `ledger.service.ts`).
