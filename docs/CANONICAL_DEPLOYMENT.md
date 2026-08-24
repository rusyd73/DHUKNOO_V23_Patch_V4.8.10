# DHUKNOO Canonical Deployment

Satu-satunya Compose resmi adalah `docker-compose.yml` di root proyek.
Compose lain di folder `backend/` atau `docker/` adalah legacy.

## Arsitektur

- Database: Supabase dari `DATABASE_URL` dalam `backend/.env`.
- Redis: internal Docker.
- Backend: internal port 3000, tidak diekspos langsung.
- Nginx/frontend: `127.0.0.1:8080`.
- Cloudflare Tunnel: `http://localhost:8080`.
- Payout: `PAYOUT_MODE=MANUAL` sampai gateway siap.

## Environment wajib

`backend/.env` tidak boleh dimasukkan ke ZIP atau Git:

```env
NODE_ENV=production
DATABASE_URL=postgresql://...
JWT_SECRET=minimum-32-karakter
JWT_REFRESH_SECRET=minimum-32-karakter-dan-berbeda
ALLOWED_ORIGINS=https://domain-anda.example
SUPER_ADMIN_EMAIL=admin-domain-anda@example.com
PAYOUT_MODE=MANUAL
```

## Deploy staging

Backup database, lalu dari root proyek:

```bash
docker compose config
docker compose build --no-cache
docker compose up -d
docker compose ps
docker compose logs backend --tail=100
```

Backend menjalankan `prisma migrate deploy` sebelum server aktif. Jangan
menjalankan `prisma migrate reset` pada database berisi data.

## Smoke test

1. Buka `http://localhost:8080/health`.
2. Login customer, driver, merchant, dan Super Admin.
3. Uji `/api`, upload, dan Socket.IO melalui origin yang sama.
4. Uji order biasa, multi-lokasi, dan MART.
5. Uji top-up dan withdrawal manual sampai jurnal selesai.
6. Aktifkan Cloudflare Tunnel ke `http://localhost:8080`.

Untuk update berikutnya gunakan `docker compose build` lalu
`docker compose up -d`. Hindari `docker compose down -v` karena `-v`
menghapus volume upload dan Redis.
