import { RedisService } from '../../src/config/redis';

// Import file ini (efek samping saja, tanpa perlu named import) di setiap
// test integration yang menghidupkan `app` (dan karenanya RedisService.init()
// saat NODE_ENV=test -- lihat src/app.ts). Tanpa ini, koneksi Redis yang
// dibuka tiap file test tetap terbuka setelah semua test selesai, dan Jest
// gagal exit bersih ("did not exit one second after the test run").
afterAll(async () => {
  await RedisService.disconnect();
});
