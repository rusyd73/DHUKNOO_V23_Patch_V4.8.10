# Menjalankan DHUKNOO di Android (Capacitor)

Project ini sudah dimigrasikan memakai **Capacitor** — WebView native yang membungkus
aplikasi React yang sudah ada, tanpa menulis ulang UI. Folder `android/` di dalam
`frontend/` adalah project Android asli (Gradle) yang bisa langsung dibuka di
Android Studio.

> **Kenapa bukan APK jadi yang dikirim langsung?** Proses build APK butuh Android
> SDK + Gradle + koneksi ke server Google (`dl.google.com`, `maven.google.com`) dan
> `services.gradle.org` untuk mengunduh toolchain-nya. Lingkungan yang saya pakai
> untuk menyiapkan project ini tidak punya akses ke domain-domain tersebut, jadi
> compile APK terakhir harus dilakukan di komputer Anda lewat Android Studio
> (langkahnya di bawah, cukup beberapa klik).

## Yang sudah disiapkan
- ✅ `@capacitor/core`, `@capacitor/android`, `@capacitor/cli` sudah terpasang di `package.json`.
- ✅ `capacitor.config.ts` — konfigurasi app ID (`com.dhuknoo.app`), nama app, dan mode dev/production.
- ✅ Folder `android/` — project Gradle native lengkap, siap dibuka Android Studio.
- ✅ Permission Android sudah ditambahkan (`AndroidManifest.xml`): INTERNET, lokasi (buat fitur auto-update GPS driver), kamera (buat scan QRIS & upload dokumen).
- ✅ `apiClient.ts` & `socket.ts` sudah diperbaiki supaya bisa terhubung ke backend lewat alamat eksplisit (`VITE_API_BASE_URL`) — sebelumnya bergantung pada `window.location.origin` yang TIDAK berlaku sama sekali di WebView native.

## Langkah menjalankan di HP Anda

### 1. Siapkan alamat backend
Salin `.env.example` jadi `.env` di folder `frontend/`, lalu isi dengan IP LAN
komputer Anda (BUKAN `localhost`/`127.0.0.1` — itu akan merujuk ke HP itu sendiri):

```
VITE_API_BASE_URL=http://192.168.1.10:3000
```

Cara cek IP LAN komputer:
- Windows: `ipconfig` → lihat "IPv4 Address"
- Mac/Linux: `ifconfig | grep "inet "`

Pastikan HP & komputer nyala di **WiFi yang sama**.

### 2. Jalankan backend
```bash
cd backend
npm install
npx prisma generate
npm run dev
```
Pastikan backend listen di `0.0.0.0` (bukan cuma `127.0.0.1`) supaya bisa diakses dari HP — cek `backend/src/server.ts`.

### 3. Install Android Studio (kalau belum ada)
Unduh dari https://developer.android.com/studio — ini yang menyediakan Android SDK
+ Gradle secara otomatis.

### 4. Pilih mode testing

**Mode A — Live Reload (disarankan untuk coba-coba/development, paling cepat):**
```bash
cd frontend
npm install
npm run dev          # Vite dev server nyala di http://0.0.0.0:5173
```
Buka `capacitor.config.ts`, uncomment bagian `server.url` dan isi dengan
`http://<IP-LAN-ANDA>:5173`, lalu:
```bash
npx cap sync android
```
Buka folder `frontend/android` di Android Studio → tunggu Gradle sync selesai →
colok HP via USB (aktifkan USB Debugging di Developer Options) atau pakai
emulator → klik tombol ▶ Run. Perubahan kode di editor langsung ke-refresh di
HP tanpa build ulang APK.

**Mode B — APK Mandiri (hasil akhir, tidak perlu Vite nyala terus):**
```bash
cd frontend
npm install
npm run android:sync   # build web assets + sync ke project Android sekaligus
```
Buka folder `frontend/android` di Android Studio → **Build → Build Bundle(s) / APK(s) → Build APK(s)**.
APK hasil ada di `android/app/build/outputs/apk/debug/app-debug.apk` — tinggal
kirim/install manual ke HP mana pun (tidak perlu kabel USB lagi, tapi tetap
butuh backend yang bisa dijangkau lewat `VITE_API_BASE_URL`).

### 5. Kalau ada masalah koneksi
- **Request gagal / network error**: cek lagi `VITE_API_BASE_URL` di `.env` — harus IP LAN, bukan localhost, dan backend harus benar-benar listen di `0.0.0.0`.
- **"Cleartext traffic not permitted"**: sudah ditangani lewat `cleartext: true` di `capacitor.config.ts`, tapi kalau masih muncul, pastikan `npx cap sync android` sudah dijalankan ULANG setelah edit config.
- **Lokasi GPS tidak jalan**: pastikan izin lokasi di-approve saat app pertama minta (popup Android), dan GPS/lokasi HP dalam keadaan aktif.
- **Kamera scan QRIS tidak jalan**: sama, pastikan izin kamera di-approve.
- **CORS ditolak backend**: kalau `backend/.env` punya `ALLOWED_ORIGINS` yang dibatasi, tambahkan origin app Capacitor (`https://localhost` atau `capacitor://localhost`) ke daftarnya, atau kosongkan sementara saat development.

## Build untuk rilis produksi (Play Store, dsb)
Mode B di atas menghasilkan APK **debug**, cukup untuk uji coba internal & install manual.
Untuk rilis ke Play Store, App Bundle (.aab) perlu ditandatangani dengan keystore
sungguhan — ikuti panduan resmi Capacitor: https://capacitorjs.com/docs/android/deploying-to-google-play
