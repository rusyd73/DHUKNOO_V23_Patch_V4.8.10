# DHUKNOO Public Beta Module — V12.7.7 Baseline

Modul publikasi ini ditambahkan tanpa mengubah lifecycle order, dispatch, tariff, wallet, socket, atau portal role yang sudah ada.

## Public URLs
- `/public` — landing page publik
- `/survey` — survey publik bercabang Customer/Driver/Merchant/Umum
- `/beta` — pendaftaran penguji Public Beta

## API
- `POST /api/public/survey` — menyimpan jawaban survey
- `POST /api/public/beta` — menyimpan pendaftaran beta
- `GET /api/public/insights` — ringkasan + data terbaru, hanya role ADMIN

Semua endpoint `/api/public/*` tetap melewati global API rate limiter yang sudah ada di baseline.

## Database
Migration baru:
`backend/prisma/migrations/20260822063000_add_public_beta_feedback/migration.sql`

Model baru:
- `PublicSurveyResponse`
- `PublicBetaRegistration`

Saat deploy database production jalankan mekanisme migration yang sama dengan baseline, misalnya `npx prisma migrate deploy` dari folder backend sesuai prosedur deployment yang berlaku.

## Prinsip isolasi baseline
Root launcher `/` tetap tidak diubah menjadi landing page. Public Experience hanya aktif saat pathname dimulai dengan `/public`, `/survey`, atau `/beta`. Ini menjaga portal Customer/Driver/Merchant/Admin dan lifecycle aplikasi V12.7.7 tetap pada jalur sebelumnya.

## Campaign source tracking
Link promosi dapat menggunakan query parameter `src`, contoh:
`/public?src=instagram`
`/survey?src=whatsapp`
`/beta?src=tiktok`

Nilai `src` disimpan bersama respons sehingga kanal publikasi dapat dibandingkan pada fase evaluasi.
