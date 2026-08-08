import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const DEFAULT_JWT_SECRET = 'dhuknoo_jwt_super_secret_key_2026';
const DEFAULT_JWT_REFRESH_SECRET = 'dhuknoo_refresh_jwt_token_key_2026';

export const ENV = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT || '3000', 10),
  DATABASE_URL: process.env.DATABASE_URL || 'postgresql://dhuknoo_admin:dhuknoo_secure_pass_2026@localhost:5432/dhuknoo_db?schema=public',
  JWT_SECRET: process.env.JWT_SECRET || DEFAULT_JWT_SECRET,
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || DEFAULT_JWT_REFRESH_SECRET,
  SENTRY_DSN: process.env.SENTRY_DSN || '',
  REDIS_URL: process.env.REDIS_URL || '',
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  // Daftar origin frontend yang diizinkan (comma-separated), dipakai untuk CORS
  // Express DAN Socket.IO. Contoh: "https://app.dhuknoo.id,https://admin.dhuknoo.id".
  // Kosong/tidak diset -> fallback "*" (semua origin, HANYA untuk development).
  ALLOWED_ORIGINS: (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  // Nomor WhatsApp Admin/CS default (format internasional tanpa "+", mis. 6281252185515),
  // dipakai sebagai fallback saat customer/driver belum punya nomor telepon terdaftar.
  ADMIN_WHATSAPP_NUMBER: process.env.ADMIN_WHATSAPP_NUMBER || '6281252185515',
};

// 🆕 AUDIT KEAMANAN — HARD-FAIL DI PRODUCTION UNTUK SECRET DEFAULT.
// SEBELUMNYA: kalau operator lupa set JWT_SECRET/JWT_REFRESH_SECRET di file
// .env production, aplikasi tetap jalan diam-diam memakai nilai default yang
// tertulis JELAS di source code ini (dan sekarang ikut ter-copy ke mana pun
// repo ini dibagikan). Siapa pun yang punya source code ini bisa MEMALSUKAN
// token JWT valid untuk USER MANAPUN (termasuk admin) di server production
// yang salah konfigurasi. Sekarang aplikasi menolak untuk start di production
// kalau secret-nya masih default, atau kalau ALLOWED_ORIGINS kosong (CORS
// jatuh ke wildcard "*" yang terlalu terbuka untuk production).
if (ENV.NODE_ENV === 'production') {
  const problems: string[] = [];
  if (ENV.JWT_SECRET === DEFAULT_JWT_SECRET) {
    problems.push('JWT_SECRET belum di-set (masih memakai default bawaan kode)');
  }
  if (ENV.JWT_REFRESH_SECRET === DEFAULT_JWT_REFRESH_SECRET) {
    problems.push('JWT_REFRESH_SECRET belum di-set (masih memakai default bawaan kode)');
  }
  if (ENV.JWT_SECRET.length < 32) {
    problems.push('JWT_SECRET terlalu pendek (minimal 32 karakter acak direkomendasikan)');
  }
  if (ENV.ALLOWED_ORIGINS.length === 0) {
    problems.push('ALLOWED_ORIGINS belum di-set (CORS akan jatuh ke wildcard "*" di production)');
  }
  if (problems.length > 0) {
    // eslint-disable-next-line no-console
    console.error(
      '\n🚨 FATAL: Konfigurasi keamanan production tidak lengkap:\n' +
        problems.map((p) => `   - ${p}`).join('\n') +
        '\n\nSet environment variable yang sesuai di file .env production sebelum menjalankan server.\n'
    );
    process.exit(1);
  }
}
