import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const customerApi = fs.readFileSync(path.join(root, 'frontend/src/api/customer.api.ts'), 'utf8');
const sharedApi = fs.readFileSync(path.join(root, 'packages/shared-api/index.ts'), 'utf8');
const orderRoutes = fs.readFileSync(path.join(root, 'backend/src/modules/order/order.routes.ts'), 'utf8');
const customerRoutes = fs.readFileSync(path.join(root, 'backend/src/modules/customer/customer.routes.ts'), 'utf8');

const checks = [
  [!customerApi.includes('api.post(API_ENDPOINTS.customer.orders'), 'CustomerAPI.createOrder must not POST to customer.orders'],
  [customerApi.includes('api.post(API_ENDPOINTS.order.create'), 'CustomerAPI.createOrder must use API_ENDPOINTS.order.create'],
  [sharedApi.includes("create: '/api/order'"), 'shared API must define canonical POST /api/order'],
  [orderRoutes.includes("router.post('/'"), 'backend must register POST /api/order'],
  [customerRoutes.includes("'/orders'") && customerRoutes.includes('router.get'), 'customer order history route must remain GET /api/customer/orders'],
];

const failed = checks.filter(([, message]) => !checks.find(([ok, m]) => m === message)?.[0]);
for (const [ok, message] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} - ${message}`);
if (failed.length) process.exit(1);
