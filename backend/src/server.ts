import { httpServer } from './app';
import { logger } from './config/logger';
import { ENV } from './config/env';

// PENTING: `app.ts` SUDAH memanggil `startServices()` (Redis, metrics, BullMQ) dan
// menginisialisasi Socket.IO + background jobs sendiri, otomatis saat file itu
// di-import (selama NODE_ENV !== 'test') — lihat komentar di app.ts. Karena
// `import { httpServer } from './app'` di baris atas SUDAH memicu itu semua, file
// ini TIDAK boleh memanggilnya lagi, atau semuanya akan terinisialisasi dua kali
// (koneksi Redis dobel, listener Socket.IO dobel, cron job dobel, dst).
// Satu-satunya tanggung jawab file ini: benar-benar menjalankan server lewat `.listen()`.

const PORT = ENV.PORT || 3000;
httpServer.listen(PORT, () => {
  logger.info(`DHUKNOO Clean Architecture Server actively running on port ${PORT}`);
});
