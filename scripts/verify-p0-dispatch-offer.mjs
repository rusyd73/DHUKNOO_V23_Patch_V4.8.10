import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const files = {
  order: path.join(root, 'backend/src/modules/order/order.service.ts'),
  dispatch: path.join(root, 'backend/src/modules/dispatch/dispatch.service.ts'),
  driver: path.join(root, 'frontend/src/pages/DriverApp.tsx'),
};
for (const [name, file] of Object.entries(files)) {
  if (!fs.existsSync(file)) throw new Error(`Missing ${name}: ${file}`);
}
const order = fs.readFileSync(files.order, 'utf8');
const dispatch = fs.readFileSync(files.dispatch, 'utf8');
const driver = fs.readFileSync(files.driver, 'utf8');
const checks = [
  ['ServiceType enum cast', order.includes('d."serviceType" = ${serviceType}::"ServiceType"')],
  ['No actionable new-order pool broadcast', !order.includes("emitToDriversPool('new_order_available'")],
  ['Targeted dispatch offer', dispatch.includes('DISPATCH_CONSTANTS.NEW_ORDER_EVENT')],
  ['Manual offer state', driver.includes('const [offeredJob, setOfferedJob]')],
  ['Manual offer accept button', driver.includes('acceptJobMutation.mutate(offeredJob.id)')],
  ['Accepted event carries status', dispatch.includes('status: (order as any).status')],
];
let failed = 0;
for (const [label, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} - ${label}`), failed += ok ? 0 : 1;
if (failed) process.exit(1);
console.log('P0 dispatch offer regression checks passed.');
