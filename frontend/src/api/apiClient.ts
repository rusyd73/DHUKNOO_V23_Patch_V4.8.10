import { createApiClient, API_ENDPOINTS } from "@obama/shared-api";
import { useAuthStore } from "../store/useAuthStore";

// PERBAIKAN: sebelumnya kalau `token` di store kosong (mis. access token JWT
// asli KEDALUWARSA seperti biasa, kejadian NORMAL), kode ini mengarang token
// PALSU non-JWT ("token_<userId>" / "token_usr_cust_1") dan — parahnya —
// MENIMPA token asli di localStorage/store dengan string karangan itu. Token
// karangan itu jelas GAGAL diverifikasi jwt.verify() di backend (bukan JWT
// valid sama sekali), jadi backend membalas 403 "Token kedaluwarsa atau
// tidak valid!" — DAN karena sudah kadung ditulis ke localStorage, SEMUA
// request berikutnya (termasuk /api/wallet/topup & /api/upload/image yang
// dilaporkan gagal 403) ikut memakai token rusak yang sama sampai user
// logout manual & login ulang. Sekarang: kalau tidak ada token asli, JANGAN
// kirim Authorization sama sekali (biar backend jujur balas 401), dan JANGAN
// PERNAH menulis token karangan ke storage.
export const api = createApiClient(
  () => {
    const token = useAuthStore.getState().token;
    if (!token || token === "null" || token === "undefined") {
      return null;
    }
    return token;
  },
  undefined
);

// 🆕 PERBAIKAN BUG KRITIS: single-flight refresh token untuk mencegah race
// condition yang menyebabkan LOGOUT LOOP terus-menerus.
//
// Sebelumnya: setiap request yang gagal dengan 401 memanggil ulang
// /auth/refresh SENDIRI-SENDIRI, tanpa koordinasi. Kalau 2+ request 401
// hampir bersamaan (SANGAT umum: begitu access token 15 menit kedaluwarsa
// saat app dibuka kembali setelah idle, beberapa query React Query yang
// terpasang paralel semuanya 401 di waktu yang nyaris sama), masing-masing
// membaca `refreshToken` LAMA yang SAMA dari store lalu mengirimnya ke
// /auth/refresh secara terpisah.
//
// Sejak refresh token sekarang DIROTASI di server setiap dipakai (lihat
// backend/src/modules/auth/auth.service.ts handleRefreshToken), panggilan
// PERTAMA berhasil dan refreshToken lama langsung tidak valid lagi. Semua
// panggilan lain yang menyusul (memakai refreshToken lama yang sama,
// dibaca SEBELUM panggilan pertama sempat memperbarui store) otomatis
// DITOLAK server -- dan blok catch-nya memanggil logout(), padahal sesi
// user sebenarnya baik-baik saja (refresh pertama sukses). Ini yang
// menyebabkan user ter-logout terus-menerus setiap login.
//
// Perbaikan: HANYA request 401 PERTAMA yang benar-benar memanggil
// /auth/refresh. Semua request 401 lain yang datang selagi refresh masih
// berjalan cukup MENUNGGU promise yang sama, lalu memakai access token
// baru yang sama untuk retry -- tidak ada lagi refresh token lama yang
// terpakai dua kali.
let refreshInFlight: Promise<{ accessToken: string; refreshToken: string }> | null = null;

// 🆕 FIX "Refresh security" (audit lanjutan): rToken sekarang bisa
// null/undefined DI WEB SETELAH RELOAD HALAMAN (refreshToken sengaja
// TIDAK LAGI disimpan di localStorage sama sekali, lihat
// store/useAuthStore.ts + lib/secureTokenStorage.ts -- httpOnly cookie
// yang jadi satu-satunya pembawa refresh token di web). rToken hanya
// dikirim di body kalau memang ADA (native, atau web yang baru saja
// login di tab yang sama) -- kalau tidak ada, body dikirim kosong dan
// backend tetap bisa membaca refresh token dari cookie httpOnly (lihat
// auth.controller.ts: `req.cookies?.refreshToken || req.body?.refreshToken`).
async function performTokenRefresh(rToken?: string | null): Promise<{ accessToken: string; refreshToken: string }> {
  const res = await api.post(API_ENDPOINTS.auth.refresh, rToken ? { refreshToken: rToken } : {});
  // 🆕 FIX P0 KONTRAK AUTH: `res` di sini adalah response axios MENTAH,
  // jadi `res.data` = body JSON `{ success, data: { accessToken,
  // refreshToken } }` (lihat auth.controller.ts refreshToken()) --
  // BUKAN payload-nya langsung. Sebelumnya kode membaca res.data.accessToken
  // yang selalu undefined, membuat SETIAP auto-refresh gagal dengan
  // "Refresh token response tidak mengandung accessToken." walau request
  // ke server sebenarnya sukses -- efeknya user ter-logout terus-menerus
  // begitu access token 15 menit kedaluwarsa.
  const newAccessToken = res.data?.data?.accessToken;
  const newRefreshToken = res.data?.data?.refreshToken || rToken;

  if (!newAccessToken) {
    throw new Error("Refresh token response tidak mengandung accessToken.");
  }

  useAuthStore.getState().login(useAuthStore.getState().user!, newAccessToken, newRefreshToken);

  return { accessToken: newAccessToken, refreshToken: newRefreshToken };
}

// 🆕 PERBAIKAN BUG KRITIS #2 (logout loop): endpoint auth ini TIDAK BOLEH
// masuk ke alur refresh-lalu-retry / logout otomatis di bawah. Kalau
// endpoint ini sendiri yang 401 (mis. /auth/login dengan password salah,
// atau /auth/logout yang requestnya sendiri kadaluwarsa), interceptor di
// bawah sebelumnya tetap memprosesnya dan memanggil logout() -- dan
// karena useAuthStore.logout() SEKARANG memanggil AuthAPI.logout() (lihat
// store/useAuthStore.ts), sebuah request /auth/logout yang gagal 401 akan
// memicu logout() lagi lewat interceptor ini, yang memanggil
// AuthAPI.logout() lagi (kali ini TANPA token sama sekali karena sudah
// kadung dihapus oleh percobaan logout() sebelumnya), gagal 401 lagi,
// logout() lagi... LOOP TANPA HENTI. Endpoint di bawah ini sekarang
// dilewatkan apa adanya -- biarkan pemanggilnya (form login, dst) yang
// menangani error 401-nya secara normal.
const AUTH_ENDPOINTS_EXCLUDED_FROM_REFRESH_DANCE = [
  API_ENDPOINTS.auth.login,
  API_ENDPOINTS.auth.register,
  API_ENDPOINTS.auth.refresh,
  API_ENDPOINTS.auth.logout,
];

api.interceptors.response.use(
  (response: any) => response,
  async (error: any) => {
    const originalRequest = error.config;
    const isExcludedAuthEndpoint = AUTH_ENDPOINTS_EXCLUDED_FROM_REFRESH_DANCE.some((endpoint) =>
      originalRequest?.url?.includes(endpoint)
    );

    if (error.response?.status === 401 && !originalRequest._retry && !isExcludedAuthEndpoint) {
      originalRequest._retry = true;

      const rToken = useAuthStore.getState().refreshToken;

      // 🆕 FIX "Refresh security": SEBELUMNYA kalau `rToken` falsy,
      // refresh TIDAK PERNAH dicoba sama sekali -- langsung logout.
      // Itu benar SELAMA refreshToken selalu ada di localStorage. TAPI
      // sekarang refreshToken SENGAJA tidak lagi disimpan di client di
      // WEB (lihat komentar di atas performTokenRefresh) -- rToken
      // akan SELALU null di web setelah reload halaman, PADAHAL cookie
      // httpOnly-nya sendiri mungkin masih benar-benar valid. Kalau
      // tetap langsung logout tanpa mencoba, user ter-logout paksa
      // setiap reload halaman walau sesinya sebenarnya masih hidup.
      // Sekarang SELALU dicoba refresh (rToken dikirim kalau ada,
      // kosong kalau tidak -- backend tetap baca dari cookie) --
      // logout HANYA terjadi kalau refresh-nya sendiri benar-benar
      // gagal (cookie juga sudah tidak valid/kedaluwarsa).
      try {
        // Kalau sudah ada refresh yang sedang berjalan (dipicu request 401
        // lain), tumpangi promise yang sama -- JANGAN mulai refresh baru.
        if (!refreshInFlight) {
          refreshInFlight = performTokenRefresh(rToken).finally(() => {
            refreshInFlight = null;
          });
        }
        const { accessToken: newAccessToken } = await refreshInFlight;

        originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
        return api(originalRequest);
      } catch {
        useAuthStore.getState().logout();
        return Promise.reject(error);
      }
    }

    return Promise.reject(error);
  }
);

// ============================================
// 🆕 PROACTIVE TOKEN REFRESH (bukan cuma reaktif nunggu 401)
// ============================================
// FIX ("driver/merchant online >15 menit tanpa order masuk, harus login
// ulang"): sebelumnya refresh HANYA terjadi reaktif -- dipicu request HTTP
// yang gagal 401. Kalau user CUMA menunggu (tidak ada request HTTP apa pun
// yang natural terjadi, cuma menunggu event Socket.IO), access token di
// storage tetap diam di sana, makin basi, sampai 15 menit lewat. Socket.IO
// reconnect (lihat services/socket.ts) lalu gagal pakai token basi itu.
// Sekarang selama user login, token di-refresh proaktif setiap 10 menit
// (5 menit sebelum access token 15 menit-nya benar-benar habis) -- jadi
// token di storage nyaris TIDAK PERNAH benar-benar kadaluarsa.
const PROACTIVE_REFRESH_INTERVAL_MS = 10 * 60 * 1000;
let proactiveRefreshTimer: ReturnType<typeof setInterval> | null = null;

export function startProactiveTokenRefresh() {
  if (proactiveRefreshTimer) return; // sudah jalan, jangan dobel
  proactiveRefreshTimer = setInterval(() => {
    const token = useAuthStore.getState().token;
    if (!token) return; // sudah logout, tidak perlu refresh
    const rToken = useAuthStore.getState().refreshToken;
    if (!refreshInFlight) {
      refreshInFlight = performTokenRefresh(rToken).finally(() => {
        refreshInFlight = null;
      });
    }
    refreshInFlight.catch(() => {
      // Diam-diam gagal di sini tidak apa-apa -- interceptor 401 di atas
      // tetap jadi jaring pengaman terakhir kalau refresh proaktif ini
      // ternyata gagal (mis. refresh token betulan sudah invalid).
    });
  }, PROACTIVE_REFRESH_INTERVAL_MS);
}

export function stopProactiveTokenRefresh() {
  if (proactiveRefreshTimer) {
    clearInterval(proactiveRefreshTimer);
    proactiveRefreshTimer = null;
  }
}