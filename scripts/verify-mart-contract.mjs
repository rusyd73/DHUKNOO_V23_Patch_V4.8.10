import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const schema = read('backend/prisma/schema.prisma');
const validation = read('backend/src/core/validation/schemas.ts');
const roles = read('backend/src/core/constants/roles.ts');
const orderService = read('backend/src/modules/order/order.service.ts');
const swagger = read('backend/src/docs/swagger-spec.ts');
const sharedTypes = read('packages/shared-types/index.ts');
const tariffApi = read('frontend/src/api/tariff.api.ts');
const driverSocket = read('frontend/src/hooks/useDriverSocket.ts');
const pricingRules = read('frontend/src/pages/admin/PricingRules.tsx');
const jobService = read('backend/src/modules/driver/services/job.service.ts');
const dispatch = read('backend/src/modules/dispatch/dispatch.service.ts');
const merchantService = read('backend/src/modules/merchant/merchant.service.ts');
const merchantSettings = read('frontend/src/pages/Settings.tsx');
const merchantRegister = read('frontend/src/pages/MerchantRegister.tsx');

const checks = [
  [schema.includes('enum ServiceType') && schema.includes('MART'), 'Prisma ServiceType contains MART'],
  [validation.includes("z.enum(['BIKE', 'CAR', 'SEND', 'MART'])"), 'Zod generic serviceType accepts MART'],
  [roles.includes("MART = 'MART'"), 'Backend ServiceType constant contains MART'],
  [orderService.includes("serviceType: 'BIKE' | 'CAR' | 'SEND' | 'MART';"), 'OrderService create-order contract accepts MART'],
  [swagger.includes("enum: ['BIKE', 'CAR', 'SEND', 'MART']"), 'Swagger serviceType documents MART'],
  [sharedTypes.includes("export type ServiceType = 'BIKE' | 'CAR' | 'SEND' | 'MART';"), 'Shared TypeScript ServiceType accepts MART'],
  [tariffApi.includes('"BIKE" | "CAR" | "SEND" | "MART"'), 'Frontend tariff preview contract accepts MART'],
  [driverSocket.includes("serviceType: 'BIKE' | 'CAR' | 'SEND' | 'MART';"), 'Driver socket payload accepts MART'],
  [pricingRules.includes('<option value="MART">MART</option>'), 'Admin pricing UI exposes MART'],
  [jobService.includes("serviceType: true") && jobService.includes('activeJobs'), 'Driver job response carries service type and active jobs'],
  [dispatch.includes('request.order.serviceType === "MART"'), 'Dispatch path explicitly handles MART'],
  [validation.includes("driverServiceType: z.enum(['BIKE', 'CAR', 'SEND'])"), 'Driver vehicle service type remains restricted to BIKE/CAR/SEND'],
  [merchantService.includes('Alamat dan lokasi merchant dikunci setelah registrasi'), 'Merchant backend rejects location changes after registration'],
  [merchantSettings.includes('Lokasi Toko') && merchantSettings.includes('Terkunci') && merchantSettings.includes('Alamat dan koordinat pickup ditetapkan') && !merchantSettings.includes('React.lazy(() => import'), 'Merchant dashboard no longer exposes editable location picker'],
  [merchantRegister.includes('LocationPicker') && merchantRegister.includes('latitude') && merchantRegister.includes('longitude'), 'Merchant registration captures initial store coordinates'],
  [schema.includes('PICKED_UP') && schema.includes('ARRIVED_CUSTOMER'), 'OrderStatus contains MART pickup/customer-arrival states'],
];

let failed = 0;
for (const [ok, message] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${message}`);
  if (!ok) failed++;
}
if (failed) {
  console.error(`\\n${failed} MART contract check(s) failed.`);
  process.exit(1);
}
console.log('\\nALL MART CONTRACT CHECKS PASS.');
