import axios from 'axios';

// 🆕 FIX API DUPLICATION + ANDROID ARCHITECTURE + REFRESH COOKIE
// INTEGRATION (audit lanjutan): file ini adalah SATU-SATUNYA implementasi
// @obama/shared-api yang benar-benar dipakai app -- resolusi module
// `@obama/shared-api` di frontend (npm workspaces, lihat root package.json
// "workspaces": ["frontend","packages/*"] + packages/shared-api/package.json
// name:"@obama/shared-api") SELALU jatuh ke sini, TIDAK PERNAH ke
// frontend/src/shared-packages/shared-api.ts (file itu dead code -- tidak
// ada satupun import yang memakainya, dan tidak ada resolve.alias di
// vite.config.ts yang mengarahkan ke sana). Akibatnya: perbaikan
// withCredentials/Android-baseURL/dst yang sebelumnya "sudah dikerjakan"
// di file yang salah TIDAK PERNAH benar-benar berlaku di app sungguhan.
// Sekarang dipindah & digabung ke sini, satu-satunya sumber kebenaran.
export const getApiBaseUrl = () => {
  // 🆕 FIX ANDROID: VITE_API_BASE_URL (dipakai README-ANDROID.md &
  // capacitor.config.ts) sebelumnya TIDAK PERNAH dibaca di sini sama
  // sekali -- hanya VITE_API_URL yang dicek, dan HANYA di cabang
  // isLocalDev. Build production APK (bukan localhost) jatuh ke cabang
  // "return window.location.origin" di bawah, yang di dalam WebView
  // Capacitor adalah skema internal app ("capacitor://localhost" /
  // "https://localhost") -- BUKAN alamat backend sungguhan. Semua
  // request API & koneksi Socket.IO gagal total di HP untuk build APK
  // mandiri manapun. Sekarang VITE_API_BASE_URL dicek PALING DULU,
  // sebelum cabang lain apa pun, konsisten dengan dokumentasi Android.
  const explicitBaseUrl = (import.meta as any)?.env?.VITE_API_BASE_URL;
  if (explicitBaseUrl) return explicitBaseUrl;

  if (typeof window === 'undefined') return 'http://localhost:3000';

  const isLocalDev =
    window.location.origin.includes('localhost') || window.location.origin.includes('127.0.0.1');

  if (isLocalDev) {
    // PERBAIKAN: sebelumnya fungsi ini balikin window.location.origin apa adanya —
    // di development itu berarti http://localhost:5173 (origin Vite dev server
    // itu sendiri, BUKAN backend Express). Semua request jadi ditembakkan balik
    // ke Vite (yang tidak punya route /api/...), makanya 404.
    // VITE_API_URL bisa dipakai untuk override kalau backend jalan di port lain.
    return (import.meta as any).env?.VITE_API_URL || 'http://localhost:3000';
  }

  // Production web: asumsikan backend di-reverse-proxy di origin yang sama
  // (mis. lewat Nginx), jadi tetap pakai origin apa adanya. (Build Android
  // production HARUS mengisi VITE_API_BASE_URL -- ditangani di cabang
  // paling atas fungsi ini, tidak akan pernah sampai baris ini.)
  return window.location.origin;
};

export const createApiClient = (
  getToken?: () => string | null,
  onTokenExpired?: () => void
) => {
  const api = axios.create({
    baseURL: getApiBaseUrl(),
    headers: {
      "Content-Type": "application/json",
    },
    // 🆕 FIX REFRESH COOKIE INTEGRATION: tanpa withCredentials:true, axios
    // TIDAK PERNAH mengirim ATAU menerima cookie sama sekali pada request
    // cross-origin -- persis kondisi app Android/Capacitor, baseURL-nya
    // memang selalu domain lain dari origin WebView, dan bahkan untuk web
    // biasa kalau frontend & backend beda subdomain. Cookie httpOnly
    // refreshToken yang di-set backend (lihat auth.controller.ts) tidak
    // pernah benar-benar tersimpan di client tanpa ini.
    withCredentials: true,
  });

  api.interceptors.request.use((config: any) => {
    if (getToken) {
      const token = getToken();

      if (token && config.headers) {
        // 🆕 FIX HARDCODED SECRETS / TOKEN LEAK: baris
        // `console.log("Authorization =", \`Bearer ${token}\`)` yang
        // sebelumnya ada di sini MENCETAK ACCESS TOKEN JWT MENTAH ke
        // console browser di SETIAP request -- gampang terekam oleh
        // browser extension jahat, session-replay tool pihak ketiga,
        // atau siapa pun yang buka DevTools di device yang dipakai
        // bersama. Dihapus total, bukan cuma di-lower-level jadi debug
        // log (token sensitif tidak boleh menyentuh console sama sekali).
        config.headers.Authorization = `Bearer ${token}`;
      }
    }

    return config;
  });

  api.interceptors.response.use(
    (response: any) => response,
    (error: any) => {
      if (error.response?.status === 401 && onTokenExpired) {
        onTokenExpired();
      }
      return Promise.reject(error);
    }
  );

  return api;
};

// Endpoint yang benar-benar terdaftar di backend (backend/src/server.ts + modules/*/*.routes.ts).
// Menjaga daftar ini sinkron dengan backend adalah tanggung jawab siapa pun yang menambah/mengubah route.
export const API_ENDPOINTS = {
  auth: {
    register: '/api/auth/register',
    login: '/api/auth/login',
    refresh: '/api/auth/refresh',
    profile: '/api/auth/profile',
    changePassword: '/api/auth/change-password',
    // 🆕 PERBAIKAN #1: Lupa/Reset Password
    requestPasswordReset: '/api/auth/reset-password-request',
    confirmPasswordReset: '/api/auth/reset-password-confirm',
    // 🆕 Logout server-side: mencabut refresh token (lihat
    // backend/src/modules/auth/auth.routes.ts POST /api/auth/logout).
    // Sebelumnya tidak ada endpoint ini sama sekali -- "logout" hanya
    // menghapus token di client, refresh token lama tetap valid di server.
    logout: '/api/auth/logout',
  },
  // Alias historis yang tetap dipertahankan backend untuk kompatibilitas mundur.
  // Untuk kode baru, lebih baik pakai `order` dan `wallet` di bawah — keduanya
  // sudah mendukung kode promo & idempotency key.
  customer: {
    profile: '/api/customer/me',
    topup: '/api/customer/wallet/topup',
    orders: '/api/customer/orders',
  },
  driver: {
    profile: '/api/driver/me',
    status: '/api/driver/status',
    jobs: '/api/driver/jobs',

  // Driver melakukan aksi menerima order
    acceptJob: (orderId: string) => `/api/order/${orderId}/accept`,
	updateJobStatus: (orderId: string) => `/api/driver/jobs/${orderId}/status`,
    uploadDocument: '/api/driver/documents',
    myDocuments: '/api/driver/documents/me',
  },
  admin: {
    dashboard: '/api/admin/dashboard',
    pendingDriverDocuments: '/api/admin/driver-documents/pending',
    reviewDriverDocument: (documentId: string) => `/api/admin/driver-documents/${documentId}/review`,
    verifyDriver: (id: string) => `/api/admin/drivers/${id}/verify`,
    suspendDriver: (id: string) => `/api/admin/drivers/${id}/suspend`,
    logs: '/api/admin/logs',
    // 🆕 PERBAIKAN #3: Otorisasi Admin — nonaktifkan/aktifkan kembali user
    users: '/api/admin/users',
    deactivateUser: (userId: string) => `/api/admin/users/${userId}/deactivate`,
    reactivateUser: (userId: string) => `/api/admin/users/${userId}/reactivate`,
  },
order: {
  create: '/api/order',
  list: '/api/order',

  accept: (orderId: string) =>
    `/api/order/${orderId}/accept`,

  updateStatus: (orderId: string) =>
    `/api/order/${orderId}/status`,

  receipt: (orderId: string) =>
    `/api/order/${orderId}/receipt`,

  sendReceiptEmail: (orderId: string) =>
    `/api/order/${orderId}/receipt/email`,

  chatHistory: (orderId: string) =>
    `/api/order/${orderId}/chat`,

  // 🆕 (Link Merchant <-> Order): checkout keranjang belanja dari satu toko.
  merchantCheckout: '/api/order/merchant-checkout',
},
  wallet: {
    balance: '/api/wallet/balance',
    transactions: '/api/wallet/transactions',
    topup: '/api/wallet/topup',
  },
  payment: {
    charge: '/api/payment/charge',
    confirmCash: '/api/payment/confirm-cash',
    submitProof: '/api/payment/proof',
    pendingProofs: '/api/payment/proof/pending',
    reviewProof: (proofId: string) => `/api/payment/proof/${proofId}/review`,
  },
  upload: {
    image: '/api/upload/image',
  },
  promo: {
    list: '/api/promo',
    validate: '/api/promo/validate',
    create: '/api/promo',
  },
  review: {
    submit: '/api/review',
    forDriver: (driverId: string) => `/api/review/driver/${driverId}`,
  },
  location: {
    updateDriver: '/api/location/driver',
    forDriver: (driverId: string) => `/api/location/driver/${driverId}`,
    onlineDrivers: '/api/location/drivers/online',
  },
  notification: {
    list: '/api/notification',
  },
  merchant: {
    list: '/api/merchant',
    detail: (merchantId: string) => `/api/merchant/${merchantId}`,
    mine: '/api/merchant/me',
    create: '/api/merchant',
    update: (merchantId: string) => `/api/merchant/${merchantId}`,
    addMenuItem: (merchantId: string) => `/api/merchant/${merchantId}/menu`,
    updateMenuItem: (itemId: string) => `/api/merchant/menu/${itemId}`,
  },
  tariff: {
    preview: '/api/tariff/preview',
    zones: '/api/tariff/zones',
    rules: '/api/tariff/rules',
    updateRule: (ruleId: string) => `/api/tariff/rules/${ruleId}`,
    regionalPolicies: '/api/tariff/regional-policies',
    updateRegionalPolicy: (policyId: string) => `/api/tariff/regional-policies/${policyId}`,
    versions: '/api/tariff/versions',
    activateVersion: (versionId: string) => `/api/tariff/versions/${versionId}/activate`,
    config: '/api/tariff/config',
    updateConfig: (key: string) => `/api/tariff/config/${key}`,
  },
  // BARU: laporan ASYNC — trigger di sini, hasilnya diberi tahu lewat event
  // socket `report_ready` (lihat services/socket.ts -> onReportReady), bukan
  // langsung di response HTTP (endpoint ini cuma balas 202 "diterima").
  report: {
    trigger: (type: string, format: 'pdf' | 'excel' = 'excel', timeframe: 'daily' | 'weekly' | 'monthly' = 'daily') =>
      `/api/report/${type}?format=${format}&timeframe=${timeframe}`,
  },
};
