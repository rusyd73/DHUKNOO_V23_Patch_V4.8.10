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
//   lewat @capacitor/preferences (native storage terpisah dari
//   localStorage WebView) alih-alih localStorage biasa. Ini BUKAN
//   hardware-keystore-encrypted (belum setara Android Keystore /
//   EncryptedSharedPreferences), tapi TIDAK bisa diakses lewat
//   `localStorage.getItem(...)` dari payload XSS generik yang jalan
//   di WebView -- perlu jembatan native Capacitor juga dikompromikan,
//   bar yang jauh lebih tinggi. Untuk proteksi setara Keystore
//   sungguhan, langkah lanjutan yang direkomendasikan: ganti ke plugin
//   seperti `capacitor-secure-storage-plugin` atau simpan lewat
//   Android Keystore langsung.
// ============================================================

import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

const REFRESH_TOKEN_KEY = 'dhuknoo_refresh_token';

export const isNativePlatform = (): boolean => {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
};

/**
 * Ambil refresh token tersimpan (HANYA berlaku untuk platform native --
 * di web selalu return null karena refresh token TIDAK PERNAH disimpan
 * di client, murni mengandalkan httpOnly cookie yang otomatis terkirim
 * axios lewat withCredentials:true).
 */
export async function getStoredRefreshToken(): Promise<string | null> {
  if (!isNativePlatform()) return null;
  try {
    const { value } = await Preferences.get({ key: REFRESH_TOKEN_KEY });
    return value ?? null;
  } catch {
    return null;
  }
}

/**
 * Simpan refresh token -- NO-OP di web (sengaja, lihat komentar di atas).
 * Di native, ditulis ke Capacitor Preferences (fire-and-forget aman
 * dipanggil dari kode sinkron seperti Zustand store).
 */
export function persistRefreshToken(token: string | null): void {
  if (!isNativePlatform()) return;
  if (!token) {
    Preferences.remove({ key: REFRESH_TOKEN_KEY }).catch(() => {});
    return;
  }
  Preferences.set({ key: REFRESH_TOKEN_KEY, value: token }).catch(() => {});
}

export function clearStoredRefreshToken(): void {
  if (!isNativePlatform()) return;
  Preferences.remove({ key: REFRESH_TOKEN_KEY }).catch(() => {});
}
