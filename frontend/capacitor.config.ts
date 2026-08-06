import type { CapacitorConfig } from '@capacitor/cli';

/**
 * PANDUAN UJI COBA DI HP ANDROID
 * ================================================================
 * 1. Pastikan HP & komputer pengembang ada di jaringan WiFi yang SAMA.
 * 2. Cari alamat IP LAN komputer Anda (bukan localhost/127.0.0.1!):
 *      - Windows : ipconfig          (lihat "IPv4 Address")
 *      - Mac/Linux: ifconfig | grep "inet "
 *    Contoh hasil: 192.168.1.10
 * 3. Buat file `.env` di folder frontend/ (sejajar package.json) isinya:
 *      VITE_API_BASE_URL=http://192.168.1.10:3000
 *    (ganti dengan IP Anda sendiri, port sesuai backend/.env PORT)
 * 4. Jalankan backend seperti biasa: cd backend && npm run dev
 *    (pastikan backend listen di 0.0.0.0, bukan cuma 127.0.0.1, supaya
 *    bisa diakses dari HP)
 * 5. Pilih SALAH SATU mode di bawah:
 *
 *    MODE A — Live Reload (paling cepat buat coba-coba, HP & PC harus
 *    tetap connect WiFi yang sama selama testing):
 *      a. Jalankan `npm run dev` di folder frontend (Vite dev server)
 *      b. Uncomment blok `server: { url: ... }` di bawah, isi dengan
 *         http://<IP-LAN-ANDA>:5173
 *      c. `npx cap sync android`
 *      d. Buka folder `android/` di Android Studio, klik Run ke HP/emulator
 *      e. Perubahan kode langsung ke-refresh di HP tanpa build ulang APK
 *
 *    MODE B — APK Mandiri (hasil build statis, tidak perlu Vite nyala):
 *      a. `npm run build` (hasil masuk ke dist/)
 *      b. Pastikan blok `server: { url: ... }` di bawah TETAP DI-COMMENT
 *      c. `npx cap sync android`
 *      d. Buka folder `android/` di Android Studio, Build > Build APK
 *
 * 6. Kalau backend masih pakai HTTP biasa (bukan HTTPS) — WAJIB, karena
 *    Android sejak API 28 memblokir cleartext traffic secara default.
 *    Config `cleartext: true` di bawah sudah menangani ini untuk mode
 *    development. Untuk rilis produksi sungguhan, pakai HTTPS di backend.
 * ================================================================
 */
const config: CapacitorConfig = {
  appId: 'com.dhuknoo.app',
  appName: 'DHUKNOO',
  webDir: 'dist',
  server: {
    // WAJIB untuk testing lokal lewat HTTP (bukan HTTPS) -- Android API 28+
    // memblokir cleartext traffic by default, ini yang membuka izinnya.
    cleartext: true,

    // MODE A (Live Reload) -- uncomment 2 baris di bawah & isi dengan IP LAN
    // komputer Anda + port Vite dev server (default 5173):
    // url: 'http://192.168.1.10:5173',
    // androidScheme: 'http',
  },
};

export default config;
