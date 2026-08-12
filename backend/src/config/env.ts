import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const NODE_ENV = process.env.NODE_ENV || 'development';

// 🆕 FIX HARDCODED SECRETS (audit lanjutan -- ini REGRESI dari fix yang
// sudah pernah ada sebelumnya di riwayat git proyek ini, commit 2f28d90,
// yang entah kenapa hilang lagi dari working tree):
//
// Sebelumnya JWT_SECRET & JWT_REFRESH_SECRET diam-diam fallback ke string
// default YANG TERTULIS JELAS DI SOURCE CODE INI ('default-secret' /
// 'default-refresh-secret') kalau env var lupa di-set. Karena source code
// proyek ini sekarang beredar (dibagikan untuk audit, disimpan di git,
// dst), string default itu SUDAH BUKAN RAHASIA -- siapa pun yang baca
// file ini bisa memalsukan JWT valid untuk USER MANAPUN (termasuk ADMIN)
// di deployment production manapun yang lupa mengisi env var tsb, tanpa
// perlu membobol apa pun -- tinggal jwt.sign() pakai secret yang sama.
//
// Fix: kalau NODE_ENV=production, WAJIB gagal start (throw) kalau
// JWT_SECRET/JWT_REFRESH_SECRET kosong, masih string default di atas,
// terlalu pendek (<32 karakter), atau JWT_SECRET===JWT_REFRESH_SECRET
// (dua secret yang sama artinya refresh token bisa dipakai sebagai
// access token dan sebaliknya kalau ada bug validasi audience/issuer).
// Di development, tetap boleh fallback ke default supaya onboarding
// developer baru tidak diblokir -- TAPI beri warning jelas di log.
function resolveSecret(envVarName: 'JWT_SECRET' | 'JWT_REFRESH_SECRET', devDefault: string): string {
  const value = process.env[envVarName];
  const knownWeakDefaults = ['default-secret', 'default-refresh-secret', 'secret', 'changeme'];

  if (NODE_ENV === 'production') {
    if (!value) {
      throw new Error(`[ENV] ${envVarName} WAJIB diisi di production! Server tidak akan start tanpa ini (mencegah pemalsuan JWT dengan secret default yang ada di source code).`);
    }
    if (value.length < 32) {
      throw new Error(`[ENV] ${envVarName} terlalu pendek (minimal 32 karakter) di production!`);
    }
    if (knownWeakDefaults.includes(value)) {
      throw new Error(`[ENV] ${envVarName} masih memakai nilai default bawaan kode yang PUBLIK/DIKETAHUI -- wajib diganti sebelum deploy production!`);
    }
    return value;
  }

  if (!value) {
    // eslint-disable-next-line no-console
    console.warn(`⚠️  [ENV] ${envVarName} tidak di-set -- memakai default DEV-ONLY. JANGAN dipakai di production!`);
    return devDefault;
  }
  return value;
}

function resolveAllowedOrigins(): string[] {
  const origins = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim()).filter(Boolean) : [];
  if (NODE_ENV === 'production' && origins.length === 0) {
    throw new Error('[ENV] ALLOWED_ORIGINS WAJIB diisi di production! Kosong berarti CORS jatuh ke wildcard, yang mematikan refresh-token cookie secara diam-diam (lihat app.ts).');
  }
  return origins;
}

export const ENV = {
  NODE_ENV,
  PORT: parseInt(process.env.PORT || '3000'),
  DATABASE_URL: process.env.DATABASE_URL || '',
  JWT_SECRET: resolveSecret('JWT_SECRET', 'default-secret'),
  JWT_REFRESH_SECRET: resolveSecret('JWT_REFRESH_SECRET', 'default-refresh-secret'),
  SENTRY_DSN: process.env.SENTRY_DSN || '',
  REDIS_URL: process.env.REDIS_URL || '',
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  ALLOWED_ORIGINS: resolveAllowedOrigins(),
  ADMIN_WHATSAPP_NUMBER: process.env.ADMIN_WHATSAPP_NUMBER || '',
  // 🔥 SMTP Configuration
  SMTP_HOST: process.env.SMTP_HOST || '',
  SMTP_PORT: parseInt(process.env.SMTP_PORT || '587'),
  SMTP_USER: process.env.SMTP_USER || '',
  SMTP_PASS: process.env.SMTP_PASS || '',
  SMTP_FROM: process.env.SMTP_FROM || '',
  // 🔥 Metrics Token
  METRICS_TOKEN: process.env.METRICS_TOKEN || '',
};

// 🆕 Guard tambahan: JWT_SECRET dan JWT_REFRESH_SECRET TIDAK BOLEH sama --
// kalau sama, dan ada bug validasi audience/issuer di masa depan, access
// token bisa dipakai sebagai refresh token (atau sebaliknya) karena
// keduanya lolos verifikasi signature yang sama.
if (NODE_ENV === 'production' && ENV.JWT_SECRET === ENV.JWT_REFRESH_SECRET) {
  throw new Error('[ENV] JWT_SECRET dan JWT_REFRESH_SECRET tidak boleh sama di production!');
}