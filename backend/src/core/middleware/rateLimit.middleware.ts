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
