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
 * 6. Kalau backend masih pakai HTTP biasa (bukan HTTPS) — WAJIB set env
 *    DHUKNOO_CLEARTEXT=true sebelum `npx cap sync android`, karena
 *    Android sejak API 28 memblokir cleartext traffic secara default:
 *      DHUKNOO_CLEARTEXT=true npx cap sync android
 *    Untuk rilis produksi sungguhan, JANGAN di-set (default aman/false)
 *    dan pakai HTTPS di backend.
 * ================================================================
 */
const config: CapacitorConfig = {
  appId: 'com.dhuknoo.app',
  appName: 'DHUKNOO',
  webDir: 'dist',
  server: {
    // 🆕 FIX "Android architecture" (audit lanjutan): SEBELUMNYA
    // `cleartext: true` di-set TANPA SYARAT di sini -- artinya APK
    // RILIS PRODUKSI (Mode B) JUGA ikut membawa izin cleartext traffic
    // (HTTP polos, bukan HTTPS) permanen, bukan cuma build development.
    // Ini memperlebar permukaan serangan produksi secara tidak perlu
    // (WebView jadi bisa membuat request HTTP polos ke domain apa pun,
    // rentan downgrade/MITM) walau backend produksi sungguhan sudah
    // pakai HTTPS -- flag ini tidak akan pernah "otomatis mati sendiri"
    // hanya karena URL yang dipakai kebetulan https.
    //
    // Sekarang: cleartext HANYA aktif kalau developer secara SADAR
    // mengisi env DHUKNOO_CLEARTEXT=true sebelum menjalankan
    // `npx cap sync android` (dipakai untuk testing lokal HTTP biasa,
    // lihat panduan Mode A/B di atas). Default (tidak di-set) = false,
    // aman untuk build production/rilis.
    cleartext: process.env.DHUKNOO_CLEARTEXT === 'true',

    // MODE A (Live Reload) -- uncomment 2 baris di bawah & isi dengan IP LAN
    // komputer Anda + port Vite dev server (default 5173):
    // url: 'http://192.168.1.10:5173',
    // androidScheme: 'http',
  },
};

export default config;
