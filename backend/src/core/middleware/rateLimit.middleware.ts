import rateLimit from 'express-rate-limit';

/**
 * Membatasi percobaan login & registrasi agar tidak bisa di-brute-force.
 * 10 percobaan per 15 menit per IP — cukup longgar untuk pengguna asli yang
 * salah ketik password beberapa kali, tapi menyulitkan serangan otomatis.
 */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 menit
  limit: 10,
  standardHeaders: true, // kirim info limit lewat header RateLimit-*
  legacyHeaders: false,
  message: {
    error: 'Terlalu banyak percobaan dari alamat IP ini. Silakan coba lagi dalam beberapa menit.',
  },
  // Key berdasarkan IP + email yang dicoba, supaya satu penyerang tidak bisa
  // menghabiskan jatah percobaan orang lain yang kebetulan berbagi IP (mis. NAT kampus/kantor)
  keyGenerator: (req) => {
    const email = (req.body?.email || 'unknown').toLowerCase();
    return `${req.ip}:${email}`;
  },
});

/**
 * Limiter lebih longgar untuk endpoint umum yang dipanggil berkali-kali oleh
 * client normal (mis. refresh token, polling lokasi) — mencegah abuse tanpa
 * mengganggu pemakaian wajar.
 */
export const generalRateLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 menit
  limit: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Terlalu banyak permintaan dari alamat IP ini. Silakan coba lagi sesaat lagi.',
  },
});

/**
 * 🆕 FIX P1 "Rate limit dan abuse protection" (audit): limiter untuk aksi
 * ADMIN yang mengubah data finansial/kewenangan (create-admin, kredit
 * wallet manual) -- SEBELUMNYA endpoint-endpoint ini HANYA dilindungi
 * authenticateToken + authorizeRoles('ADMIN'), tanpa rate limit sama
 * sekali. Kalau kredensial admin bocor/dicuri (session hijack, token
 * leak), penyerang bisa memukul endpoint ini berkali-kali tanpa batas.
 * Key berdasarkan userId (bukan IP) karena ini endpoint TERAUTENTIKASI --
 * satu admin, bagaimanapun IP-nya berubah, tetap kena limit yang sama.
 */
export const sensitiveAdminActionRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 menit
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Terlalu banyak aksi admin sensitif dalam waktu singkat. Silakan coba lagi dalam beberapa menit.',
  },
  keyGenerator: (req: any) => req.user?.id || req.ip,
});

/**
 * 🆕 FIX P1 "Rate limit dan abuse protection" (audit): limiter untuk
 * pembuatan order -- SEBELUMNYA POST /api/orders dan
 * /api/orders/merchant-checkout tidak dibatasi sama sekali, membuka
 * celah spam order (membebani antrean dispatch/driver dengan order
 * palsu) atau abuse promo/diskon lewat order berulang cepat. Key
 * berdasarkan userId (endpoint terautentikasi).
 */
export const orderCreationRateLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 menit
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Terlalu banyak order dibuat dalam waktu singkat. Silakan coba lagi sesaat lagi.',
  },
  keyGenerator: (req: any) => req.user?.id || req.ip,
});

/**
 * 🆕 FIX P1 "Rate limit dan abuse protection" (audit): limiter untuk
 * endpoint upload file -- SEBELUMNYA /api/upload/image dan
 * /api/files/upload tidak dibatasi sama sekali, membuka celah abuse
 * (spam upload memenuhi disk server, atau brute-force mencoba berbagai
 * payload untuk mem-bypass validasi magic-byte yang baru ditambahkan).
 * Key berdasarkan userId (endpoint terautentikasi).
 */
export const uploadRateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 menit
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Terlalu banyak upload dalam waktu singkat. Silakan coba lagi beberapa menit lagi.',
  },
  keyGenerator: (req: any) => req.user?.id || req.ip,
});
