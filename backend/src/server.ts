// ============================================================
// 🔒 SERVER BOOTSTRAP -- SATU-SATUNYA ENTRY POINT PRODUCTION
//
// 🆕 FIX KRITIS "Legacy runtime" (audit lanjutan): file ini SEBELUMNYA
// adalah implementasi Express TERPISAH TOTAL dari app.ts -- backend
// demo in-memory (array JS biasa, hilang tiap restart), TANPA Prisma,
// TANPA bcrypt (password plain-text), TANPA JWT asli (token cuma
// string "token_<userId>", gampang ditebak/dipalsukan siapa saja yang
// tahu/menebak ID user), DAN py punya backdoor password universal:
// `if (matchedUser.password !== password && password !== "123456")`
// -- LITERAL SIAPA PUN BISA LOGIN SEBAGAI USER MANAPUN (termasuk
// admin) PAKAI PASSWORD "123456".
//
// File inilah yang SESUNGGUHNYA jadi entry point production di
// package.json ("main": "dist/server.js", "start": "node dist/server.js")
// DAN di backend/Dockerfile (CMD ["node", "dist/server.js"]) --
// ARTINYA SELURUH ARSITEKTUR MODERN DI app.ts + modules/* + Prisma
// (termasuk SEMUA perbaikan keamanan & finansial dari audit
// sebelumnya: auth, wallet, ledger, promo, websocket security, dst)
// TIDAK PERNAH BENAR-BENAR BERJALAN DI PRODUCTION. Yang berjalan
// adalah demo stub tidak aman ini.
//
// app.ts sendiri sudah punya komentar yang menyatakan intent aslinya:
// "server.ts adalah satu-satunya tempat yang boleh memanggil
// `.listen()`" -- file ini sekarang benar-benar memenuhi peran itu:
// HANYA bootstrap tipis yang mengimpor app.ts (arsitektur modern) dan
// membuka port. Tidak ada logic bisnis, tidak ada in-memory store,
// tidak ada route, sama sekali -- semua itu sudah ada di app.ts dan
// modules/* yang sesungguhnya, didukung Prisma (database sungguhan,
// bukan array JS yang hilang tiap restart).
// ============================================================

import { app, httpServer } from './app';
import { ENV } from './config/env';
import { logger } from './config/logger';
import { prisma } from './config/prisma';

// CATATAN: startServices() TIDAK dipanggil lagi di sini secara eksplisit
// -- app.ts SUDAH men-trigger-nya sendiri sebagai side-effect saat
// di-import (dijaga `if (NODE_ENV !== 'test')`). Memanggilnya lagi di
// sini berisiko menginisialisasi Redis/Queue/Mailer dua kali. Import
// `{ app, httpServer }` dari './app' di baris atas SUDAH CUKUP untuk
// men-trigger seluruh startup arsitektur modern (Sentry, Redis,
// Metrics, Queue, Mailer, Socket.IO, BackgroundJobs, semua route
// modules, Prisma) sebelum baris listen() di bawah dieksekusi.
httpServer.listen(ENV.PORT, '0.0.0.0', () => {
  logger.info(
    `🚀 DHUKNOO backend (arsitektur modern: app.ts -> modules -> Prisma) berjalan di port ${ENV.PORT} [${ENV.NODE_ENV}]`
  );
});

// ============================================================
// 🔒 GRACEFUL SHUTDOWN
// Menutup koneksi Prisma & HTTP server dengan bersih saat proses
// dihentikan (mis. `docker stop`, deploy baru, Ctrl+C) -- mencegah
// koneksi DB menggantung atau request yang sedang berjalan terputus
// paksa di tengah transaksi finansial.
// ============================================================
async function shutdown(signal: string) {
  logger.info(`[SERVER] Menerima ${signal}, memulai graceful shutdown...`);
  httpServer.close(async () => {
    try {
      await prisma.$disconnect();
    } catch (err: any) {
      logger.error('[SERVER] Error saat disconnect Prisma: %s', err?.message || err);
    }
    logger.info('[SERVER] Shutdown selesai.');
    process.exit(0);
  });

  // Force-exit kalau graceful shutdown macet lebih dari 10 detik
  setTimeout(() => {
    logger.error('[SERVER] Graceful shutdown timeout -- force exit.');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export { app };
