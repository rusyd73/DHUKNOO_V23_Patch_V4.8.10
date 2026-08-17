# DHUKNOO Ride-Hailing Platform — V23.1.6

> **Catatan (P2 audit E.5):** README ini menggantikan versi sebelumnya yang
> masih berisi boilerplate template "AI Studio" (banner Google AI Studio,
> `GEMINI_API_KEY`) — sisa dari scaffolding awal yang sudah tidak sesuai
> sama sekali dengan struktur proyek monorepo yang sebenarnya sekarang.

Platform ride-hailing & marketplace (ojek, mobil, kirim barang, belanja
merchant) — monorepo berisi backend API, frontend web (juga di-bundle ke
Android lewat Capacitor), dan package TypeScript yang dipakai bersama.

## Struktur Proyek

```
.
├── backend/          Express + TypeScript + Prisma + PostgreSQL + Redis
│   ├── src/modules/  Satu folder per domain (auth, order, payment, wallet,
│   │                 ledger, dispatch, merchant, admin, upload, file, dst.)
│   ├── prisma/       Schema database & migration
│   └── tests/        Unit test (tests/unit) + integration test (tests/integration)
├── frontend/         React + TypeScript + Vite; di-bundle ke Android via Capacitor
├── packages/         Package TypeScript yang dipakai bersama backend/frontend
│   ├── shared-api/
│   ├── shared-types/
│   └── shared-utils/
├── docker/           Konfigurasi Prometheus + Grafana untuk observability
├── docker-compose.yml
└── .github/workflows/ci.yml   Typecheck → lint → unit test → integration
                                 test → Prisma validate/migrate → build
```

## Menjalankan Secara Lokal

**Prasyarat:** Node.js ≥ 18, Docker (untuk PostgreSQL + Redis lokal).

1. Salin `backend/.env.example` menjadi `backend/.env` dan isi variabelnya.
   Untuk frontend, `frontend/.env.example` dapat disalin menjadi
   `frontend/.env`. Minimal `DATABASE_URL`, `JWT_SECRET`, dan
   `JWT_REFRESH_SECRET` wajib diisi; backend akan menolak start di
   production kalau secret kosong/masih default.
2. Nyalakan PostgreSQL & Redis:
   ```bash
   docker compose up -d postgres redis
   ```
3. Install seluruh dependency (root + backend, workspaces menangani frontend/packages):
   ```bash
   npm run install:all
   ```
4. Generate Prisma client & terapkan schema:
   ```bash
   npm run prisma:generate
   npm --prefix backend run prisma:migrate
   ```
5. Jalankan backend & frontend (dua terminal terpisah):
   ```bash
   npm run dev:backend    # http://localhost:3000
   npm run dev:frontend   # http://localhost:5173
   ```

## Testing

Lihat `backend/tests/README.md` untuk detail lengkap struktur test dan cara
menjalankannya. Ringkas:

```bash
cd backend
npx jest tests/unit --runInBand         # cepat, tidak butuh DB
npm test                                # unit + integration, butuh Postgres nyala
```

## Build Production

```bash
npm run build   # prisma generate + build backend + build frontend (semua workspace)
```

`dist/` backend HARUS selalu di-build ulang dari `src/` terbaru sebelum
deploy — jangan pernah menjalankan `dist/` lama yang sudah tidak sinkron
dengan `src/` yang sedang di-review/audit. CI (`.github/workflows/ci.yml`)
melakukan ini otomatis di setiap push/PR.

## Dokumentasi API

Swagger/OpenAPI spec ada di `backend/src/docs/swagger-spec.ts`, disajikan
lewat endpoint `/docs` saat backend berjalan.

## V2 hotfix — 15 Aug 2026

The P0 Driver Trip Lifecycle package was revised after runtime testing exposed
`GET /jobs` failure: `TypeError: Do not know how to serialize a BigInt`.

`backend/src/modules/driver/routes/job.routes.ts` now safely serializes the
jobs response while preserving Prisma Decimal `toJSON` behavior. The package
also contains the dedicated BullMQ Redis connection fix (`maxRetriesPerRequest:
null`).

See `P0_DRIVER_TRIP_LIFECYCLE_COMPLETION_V2.txt` for the exact runtime gate.
