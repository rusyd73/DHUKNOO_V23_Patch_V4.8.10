/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/tests/**/*.test.ts'],
  // Unit test (promo.calc) tidak butuh DB — jalan di mana saja.
  // Test integration (auth.integration, health.integration) butuh Postgres + Redis
  // hidup (lihat DATABASE_URL/REDIS_URL di .env, atau service container di CI —
  // sudah dikonfigurasi otomatis di .github/workflows/deploy.yml).
  clearMocks: true,
  testTimeout: 15000,
  setupFiles: ['<rootDir>/tests/setupEnv.ts'],
};
