// ============================================================
// 🔒 SECURE TOKEN STORAGE -- WEB (httpOnly cookie) vs CAPACITOR (native storage)
//
// 🆕 FIX "Refresh security" (audit lanjutan): sebelumnya refreshToken
// SELALU disimpan di localStorage biasa, di KEDUA platform (web
// browser DAN Android/Capacitor) -- localStorage bisa dibaca lewat
// `localStorage.getItem(...)` oleh JavaScript APA PUN yang berhasil
// jalan di halaman (XSS). Kalau ada satu saja celah XSS di mana pun
// di aplikasi, refresh token (yang bisa dipakai berulang kali untuk
// mendapatkan access token baru) langsung bisa dicuri dan sesi user
// dibajak permanen sampai token di-revoke manual.
//
// Sekarang perilakunya DIPISAH per platform:
// - WEB (browser biasa): refreshToken TIDAK PERNAH disimpan di
//   localStorage/sessionStorage/JS-accessible storage manapun sama
//   sekali. Backend sudah mengirim refreshToken via httpOnly cookie
//   (lihat auth.controller.ts) yang browser kelola sendiri, TIDAK BISA
//   dibaca `document.cookie` atau JS apa pun (flag httpOnly) --
//   perlindungan penuh dari XSS untuk refresh token di web.
// - CAPACITOR (Android native): httpOnly cookie TIDAK reliable lintas
//   origin di WebView (lihat catatan di app.ts/auth.controller.ts),
//   jadi tetap butuh token tersimpan client-side -- tapi sekarang
//   lewat capacitor-secure-storage-plugin, yang di Android benar-benar
//   memakai Android Keystore (via EncryptedSharedPreferences, hardware-
//   backed di device yang mendukung StrongBox/TEE) dan di iOS memakai
//   Keychain -- BUKAN localStorage/Preferences biasa (yang cuma XML/
//   SQLite polos, bisa dibaca kalau device di-root atau lewat adb
//   backup). Ini setara level proteksi yang sama dengan cara password
//   disimpan OS -- kunci enkripsinya tidak pernah keluar dari hardware
//   keystore chip, jauh lebih tahan bahkan dari device yang di-root.
//   (🆕 Riwayat: sempat pakai @capacitor/preferences sebagai langkah
//   antara -- itu SUDAH lebih baik dari localStorage [tidak terjangkau
//   payload XSS generik yang cuma panggil localStorage.getItem()],
//   tapi BELUM hardware-encrypted; sekarang sudah digantikan penuh.)
// ============================================================

import { Capacitor } from '@capacitor/core';
import { SecureStoragePlugin } from 'capacitor-secure-storage-plugin';

const REFRESH_TOKEN_KEY = 'dhuknoo_refresh_token';

export const isNativePlatform = (): boolean => {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
};

// 🆕 FIX "Capacitor Preferences belum Android Keystore" (audit
// lanjutan): versi sebelumnya pakai @capacitor/preferences -- itu
// SUDAH lebih baik dari localStorage biasa (tidak terjangkau
// localStorage.getItem() dari payload XSS generik), TAPI @capacitor/
// preferences SENDIRI TIDAK terenkripsi hardware -- di Android, isinya
// cuma SharedPreferences file XML biasa (bisa dibaca kalau device
// di-root atau lewat adb backup di Android <12), BUKAN setara
// EncryptedSharedPreferences/Android Keystore.
//
// Diganti ke capacitor-secure-storage-plugin, yang di Android benar-
// benar memakai Android Keystore (lewat EncryptedSharedPreferences) --
// kunci enkripsinya disimpan di hardware-backed keystore chip
// (kalau device mendukung StrongBox/TEE), TIDAK BISA diekstrak
// begitu saja meski device di-root, dan TIDAK ikut kebawa backup
// biasa. Ini proteksi yang jauh lebih dekat ke "secure storage"
// sungguhan dibanding Preferences API biasa. Di iOS otomatis memakai
// Keychain (setara).
const REFRESH_TOKEN_KEY_CONST = REFRESH_TOKEN_KEY;

/**
 * Ambil refresh token tersimpan (HANYA berlaku untuk platform native --
 * di web selalu return null karena refresh token TIDAK PERNAH disimpan
 * di client, murni mengandalkan httpOnly cookie yang otomatis terkirim
 * axios lewat withCredentials:true).
 */
export async function getStoredRefreshToken(): Promise<string | null> {
  if (!isNativePlatform()) return null;
  try {
    const { value } = await SecureStoragePlugin.get({ key: REFRESH_TOKEN_KEY_CONST });
    return value ?? null;
  } catch {
    // Plugin ini throw kalau key belum pernah di-set sama sekali
    // (bukan kondisi error sungguhan) -- treat sebagai "belum ada".
    return null;
  }
}

/**
 * Simpan refresh token -- NO-OP di web (sengaja, lihat komentar di atas).
 * Di native, ditulis ke Android Keystore / iOS Keychain (fire-and-forget
 * aman dipanggil dari kode sinkron seperti Zustand store).
 */
export function persistRefreshToken(token: string | null): void {
  if (!isNativePlatform()) return;
  if (!token) {
    SecureStoragePlugin.remove({ key: REFRESH_TOKEN_KEY_CONST }).catch(() => {});
    return;
  }
  SecureStoragePlugin.set({ key: REFRESH_TOKEN_KEY_CONST, value: token }).catch(() => {});
}

export function clearStoredRefreshToken(): void {
  if (!isNativePlatform()) return;
  SecureStoragePlugin.remove({ key: REFRESH_TOKEN_KEY_CONST }).catch(() => {});
}
