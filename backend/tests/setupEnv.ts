// Nilai default agar test tetap bisa jalan walau .env belum di-setup lokal.
// Untuk test integration (butuh DB nyata), timpa nilai ini lewat .env atau
// environment variable CI — lihat README di folder tests/.
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test_jwt_refresh_secret';
process.env.DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://obama_user:obama_secure_password123@localhost:5432/obama_db?schema=public';
process.env.REDIS_URL = process.env.REDIS_URL || '';
