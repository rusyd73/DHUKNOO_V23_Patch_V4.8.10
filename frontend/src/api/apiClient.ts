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
      return undefined;
    }
    return token;
  },
  undefined
);

api.interceptors.response.use(
  (response: any) => response,
  async (error: any) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      const rToken = useAuthStore.getState().refreshToken;

      // PERBAIKAN: sebelumnya kalau refreshToken ASLI tidak ada, dipakai
      // refreshToken KARANGAN ("rtoken_<userId>") yang pasti ditolak backend,
      // lalu kalau panggilan refresh itu gagal, fallback-nya malah mengarang
      // ACCESS TOKEN palsu lagi supaya "sesi tetap terlihat aktif" — padahal
      // sesi itu sudah tidak valid. Ini yang bikin app diam-diam mengira user
      // masih login padahal semua request selanjutnya pasti 403 terus.
      // Sekarang: kalau tidak ada refreshToken asli, atau refresh gagal,
      // user di-logout beneran (bersih) supaya mereka login ulang dan dapat
      // token asli yang valid, bukan dibiarkan "nyangkut" di sesi rusak.
      if (rToken) {
        try {
          const res = await api.post(API_ENDPOINTS.auth.refresh, { refreshToken: rToken });
          const newAccessToken = res.data?.accessToken;
          const newRefreshToken = res.data?.refreshToken || rToken;

          if (!newAccessToken) {
            throw new Error("Refresh token response tidak mengandung accessToken.");
          }

          useAuthStore.getState().login(
            useAuthStore.getState().user!,
            newAccessToken,
            newRefreshToken
          );

          originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
          return api(originalRequest);
        } catch {
          useAuthStore.getState().logout();
          return Promise.reject(error);
        }
      } else {
        useAuthStore.getState().logout();
        return Promise.reject(error);
      }
    }

    return Promise.reject(error);
  }
);