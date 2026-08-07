import axios from "axios";

// PERBAIKAN UNTUK BUILD ANDROID (Capacitor): window.location.origin HANYA
// valid untuk web biasa (browser, same-origin dengan backend via reverse
// proxy). Di dalam WebView native (Capacitor), origin-nya jadi skema internal
// app ("capacitor://localhost" / "https://localhost"), BUKAN alamat server
// backend sungguhan -- kalau dipakai apa adanya, semua request API & koneksi
// Socket.IO akan gagal total di HP. VITE_API_BASE_URL (diisi di file .env,
// lihat capacitor.config.ts & README-ANDROID.md) WAJIB diisi untuk build
// Android, menunjuk ke alamat backend yang bisa dijangkau HP (mis. IP LAN
// komputer pengembang, atau domain production).
export function getApiBaseUrl(): string {
  const envUrl = (import.meta as any)?.env?.VITE_API_BASE_URL;
  if (envUrl) {
    return envUrl;
  }
  if (typeof window !== "undefined") {
    return window.location.origin;
  }
  return "http://0.0.0.0:3000";
}

export function createApiClient(getToken: () => string | null | undefined, onLogout?: () => void) {
  const instance = axios.create({
    // PERBAIKAN: sebelumnya selalu "" (relatif) -- benar untuk web (same-origin)
    // tapi SALAH TOTAL di app Android/Capacitor karena tidak ada "origin" yang
    // berarti untuk di-resolve relatif terhadapnya. Sekarang pakai
    // getApiBaseUrl() yang sama dipakai Socket.IO, supaya konsisten dan bisa
    // dioverride lewat VITE_API_BASE_URL untuk build native.
    baseURL: getApiBaseUrl(),
  });

  instance.interceptors.request.use((config) => {
    const token = getToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  });

  return instance;
}

export const API_ENDPOINTS = {
  auth: {
    register: "/api/auth/register",
    login: "/api/auth/login",
    refresh: "/api/auth/refresh",
    profile: "/api/customer/profile",
    changePassword: "/api/auth/change-password",
    // 🆕 PERBAIKAN #1 (Lupa/Reset Password): endpoint ini sebelumnya TIDAK
    // ADA di kedua salinan @obama/shared-api (di sini maupun di
    // packages/shared-api/index.ts), padahal frontend/src/api/auth.api.ts
    // sudah memanggilnya — itulah kenapa "lupa/reset password tidak bisa
    // kirim". Endpoint backend-nya sekarang sudah dibuat di
    // backend/src/modules/auth/auth.routes.ts.
    requestPasswordReset: "/api/auth/reset-password-request",
    confirmPasswordReset: "/api/auth/reset-password-confirm",
  },
  customer: {
    profile: "/api/customer/profile",
    orders: "/api/customer/orders",
  },
  driver: {
    // PERBAIKAN KRITIS: sebelumnya menunjuk ke "/api/driver/profile" yang
    // TIDAK PERNAH terdaftar di backend (backend cuma punya GET /api/driver/me)
    // -- akibatnya query profil driver 404 SETIAP SAAT, membuat isVerified/
    // isOnline/autoAcceptEnabled semuanya undefined/false di UI. Ini artinya
    // tombol "Mulai Sesi Narik" (online toggle) IKUT TERKUNCI karena kondisi
    // `!profileData?.profile?.isVerified` selalu true -- driver tidak akan
    // pernah bisa online sama sekali lewat tombol ini, yang menjelaskan
    // laporan "auto accept masih gagal" sebelumnya (wajar gagal kalau
    // driver-nya sendiri tidak pernah berhasil ONLINE).
    profile: "/api/driver/me",
    jobs: "/api/driver/jobs",
    // PERBAIKAN KRITIS: sebelumnya menunjuk ke "/api/driver/toggle-online"
    // yang TIDAK PERNAH terdaftar di backend (backend cuma punya PATCH/POST
    // /api/driver/status) -- akibatnya tombol "Mulai Sesi Narik" 404 setiap
    // kali diklik, dan driver TIDAK PERNAH benar-benar tercatat online di
    // database. Ini akar masalah paling langsung dari laporan "auto accept
    // masih gagal" -- wajar gagal kalau driver-nya sendiri tidak pernah
    // berhasil online sama sekali.
    status: "/api/driver/status",
    myDocuments: "/api/driver/documents",
    uploadDocument: "/api/driver/documents",
    updateJobStatus: (id: string) => `/api/driver/jobs/${id}/status`,
  },
  // PERBARUAN: sebelumnya TIDAK ADA endpoint client sama sekali untuk driver
  // mengirim lokasi GPS-nya sendiri secara umum (di luar sesi trip aktif) --
  // akibatnya driver yang baru toggle online (apalagi setelah tadinya
  // offline) punya latitude/longitude NULL/basi di database, dan otomatis
  // TIDAK LOLOS filter dispatch/auto-accept manapun (semuanya mensyaratkan
  // koordinat yang valid). Endpoint ini dipakai oleh DriverDashboardMap
  // untuk auto-update lokasi secara berkala.
  location: {
    updateDriver: "/api/location/driver",
  },
  admin: {
    dashboard: "/api/admin/dashboard",
    pendingDriverDocuments: "/api/driver/documents",
    reviewDriverDocument: (id: string) => `/api/driver/documents/${id}`,
    verifyDriver: (id: string) => `/api/admin/verify-driver/${id}`,
    suspendDriver: (id: string) => `/api/admin/suspend-driver/${id}`,
    logs: "/api/admin/logs",
  },
  order: {
    accept: (id: string) => `/api/driver/jobs/${id}/accept`,
    updateStatus: (id: string) => `/api/order/${id}/status`,
    chatHistory: (id: string) => `/api/order/${id}/chat`,
    sendReceiptEmail: (id: string) => `/api/order/${id}/send-receipt`,
    // 🆕 (Link Merchant <-> Order): checkout keranjang belanja dari toko.
    merchantCheckout: "/api/order/merchant-checkout",
  },
  payment: {
    charge: "/api/payments/charge",
    confirmCash: "/api/payments/confirm-cash",
    submitProof: "/api/payments/submit-proof",
    pendingProofs: "/api/payments/pending-proofs",
    reviewProof: (id: string) => `/api/payments/proofs/${id}/review`,
  },
  wallet: {
    balance: "/api/wallet/balance",
    transactions: "/api/wallet/transactions",
    topup: "/api/wallet/topup",
  },
  upload: {
    image: "/api/upload/image",
  },
  tariff: {
    preview: "/api/tariffs/preview",
    zones: "/api/tariffs/zones",
    rules: "/api/tariffs/rules",
    updateRule: (id: string) => `/api/tariffs/rules/${id}`,
    regionalPolicies: "/api/tariffs/regional-policies",
    updateRegionalPolicy: (id: string) => `/api/tariffs/regional-policies/${id}`,
    versions: "/api/tariffs/versions",
    activateVersion: (id: string) => `/api/tariffs/versions/${id}/activate`,
    config: "/api/tariffs/config",
    updateConfig: (key: string) => `/api/tariffs/config/${key}`,
  },
};
