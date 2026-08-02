import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

export const ENV = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT || '3000', 10),
  DATABASE_URL: process.env.DATABASE_URL || 'postgresql://dhuknoo_admin:dhuknoo_secure_pass_2026@localhost:5432/dhuknoo_db?schema=public',
  JWT_SECRET: process.env.JWT_SECRET || 'dhuknoo_jwt_super_secret_key_2026',
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || 'dhuknoo_refresh_jwt_token_key_2026',
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
