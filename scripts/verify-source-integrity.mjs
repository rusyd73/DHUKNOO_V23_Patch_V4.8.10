import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const required = [
  'package.json',
  'docker-compose.yml',
  '.env.example',
  'backend/package.json',
  'backend/tsconfig.json',
  'backend/jest.config.cjs',
  'backend/prisma/schema.prisma',
  'frontend/package.json',
  'frontend/tsconfig.json',
  'frontend/tsconfig.node.json',
  'frontend/vite.config.ts',
  'packages/shared-api/package.json',
  'packages/shared-api/index.ts',
  'packages/shared-utils/package.json',
  'packages/shared-utils/index.ts',
];

let failed = false;
for (const file of required) {
  const ok = fs.existsSync(path.join(root, file));
  console.log(`${ok ? 'PASS' : 'FAIL'} - required file: ${file}`);
  if (!ok) failed = true;
}

const customerApi = fs.readFileSync(path.join(root, 'frontend/src/api/customer.api.ts'), 'utf8');
if (customerApi.includes('api.post(API_ENDPOINTS.customer.orders')) {
  console.error('FAIL - createOrder still POSTs to customer.orders');
  failed = true;
} else {
  console.log('PASS - createOrder contract is canonical');
}

if (failed) process.exit(1);
