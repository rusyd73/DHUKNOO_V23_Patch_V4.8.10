import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const jobService = read('backend/src/modules/driver/services/job.service.ts');
const jobRoutes = read('backend/src/modules/driver/routes/job.routes.ts');
const driverApp = read('frontend/src/pages/DriverApp.tsx');
const orderService = read('backend/src/modules/order/order.service.ts');
const schema = read('backend/prisma/schema.prisma');
const redis = read('backend/src/config/redis.ts');
const bullmq = read('backend/src/jobs/bullmq.ts');

const checks = [
  [schema.includes('enum ServiceType') && schema.includes('MART'), 'ServiceType MART exists in Prisma schema'],
  [jobService.includes('prisma.order.findMany') && jobService.includes("status: 'PENDING'"), 'GET /jobs uses Prisma pending-job discovery'],
  [!jobService.includes('prisma.$queryRaw') && !jobService.includes('queryRawUnsafe'), 'GET /jobs hot path contains no raw SQL'],
  [jobService.includes('haversineKm'), 'Driver distance is calculated deterministically'],
  [jobService.includes('activeJobs') && jobService.includes("PICKED_UP") && jobService.includes("ARRIVED_CUSTOMER"), 'Assigned active orders are restored'],
  [jobRoutes.includes('activeJobs: result.activeJobs') && jobRoutes.includes('activeJob: result.activeJobs[0]'), 'GET /jobs exposes explicit activeJob contract'],
  [jobRoutes.includes("typeof value === 'bigint'") && jobRoutes.includes('toNumber'), 'GET /jobs response normalizes BigInt/Decimal'],
  [driverApp.includes('const [activeTrip, setActiveTrip]'), 'Driver dashboard has explicit activeTrip state'],
  [driverApp.includes("setActiveTrip(res.order)"), 'Accept/status response updates activeTrip immediately'],
  [driverApp.includes("'ON_THE_WAY'") && driverApp.includes("'ARRIVED'") && driverApp.includes("'PICKED_UP'") && driverApp.includes("'ARRIVED_CUSTOMER'") && driverApp.includes("'COMPLETED'"), 'Driver lifecycle controls exist'],
  [driverApp.includes('otherPartyPhone={activeJob.customer?.phoneNumber'), 'Active trip exposes customer phone to chat/call'],
  [orderService.includes("SocketService.emitToUser(userId, 'order_accepted'"), 'Accepting driver receives order_accepted realtime event'],
  [schema.includes('PICKED_UP') && schema.includes('ARRIVED_CUSTOMER'), 'MART has distinct pickup and customer-arrival states'],
  [jobRoutes.includes('martAllowed') && jobRoutes.includes('Lifecycle MART'), 'Driver backend enforces MART-specific lifecycle transitions'],
  [orderService.includes('martTransitions') && orderService.includes('PICKED_UP'), 'OrderService enforces MART-specific lifecycle transitions'],
  [driverApp.includes('Menuju Merchant') && driverApp.includes('Tiba di Merchant') && driverApp.includes('Ambil & Menuju Customer') && driverApp.includes('Tiba di Customer'), 'Driver UI exposes distinct MART trip stages'],
  [orderService.includes('mart_driver_heading_to_merchant') && orderService.includes('mart_driver_arrived_at_merchant') && orderService.includes('mart_driver_heading_to_customer') && orderService.includes('mart_driver_arrived_at_customer'), 'MART realtime lifecycle notifications exist'],
  [redis.includes('public static isReady(): boolean'), 'Redis readiness API exists'],
  [bullmq.includes('maxRetriesPerRequest: null'), 'BullMQ uses compatible Redis retry configuration'],
];

let failed = 0;
for (const [ok, message] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${message}`);
  if (!ok) failed++;
}

if (failed) {
  console.error(`\\n${failed} lifecycle check(s) failed.`);
  process.exit(1);
}
console.log('\\nALL V4 DRIVER LIFECYCLE STATIC CHECKS PASS.');
