/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.test.json' }],
  },
  testEnvironment: 'node',
  rootDir: '.',
  setupFiles: ['<rootDir>/tests/setupEnv.ts'],
  testMatch: ['<rootDir>/tests/**/*.test.ts'],
  clearMocks: true,
  maxWorkers: 1,
};
