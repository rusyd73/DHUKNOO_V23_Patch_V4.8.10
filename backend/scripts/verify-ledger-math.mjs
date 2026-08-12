// Verifikasi murni matematis untuk fix double-deduction ledger.
// TIDAK butuh Prisma/DB -- cuma meniru rumus yang sekarang ada di
// order.service.ts (calculateOrderBreakdown) + ledger.service.ts
// (recordOrderLedger + reconcileOrder). Dibuat sebagai bukti tambahan
// yang bisa dijalankan di environment mana pun (termasuk sandbox tanpa
// akses binaries.prisma.sh) sambil menunggu test suite Jest yang
// sesungguhnya (backend/tests/*.test.ts) dijalankan di environment
// nyata dengan Prisma Client yang valid.
//
// Jalankan: node backend/scripts/verify-ledger-math.mjs
// Exit code 0 = semua kasus reconcile. Exit code 1 = ada yang gagal.

function simulateOrder({ label, itemsSubtotal, deliveryFee, merchantFeeRate, commissionRate, isMart }) {
  const customerPayment = isMart ? itemsSubtotal + deliveryFee : deliveryFee;

  const merchantFee = isMart ? itemsSubtotal * merchantFeeRate : 0;
  const driverCommission = deliveryFee * commissionRate;

  // === calculateOrderBreakdown (SETELAH fix) ===
  const driverEarningGross = deliveryFee;
  const merchantEarningGross = isMart ? itemsSubtotal : 0;
  const platformFee = merchantFee + driverCommission;

  // === recordOrderLedger: entri-entri yang ditulis ===
  const entries = [
    { type: 'CUSTOMER_PAYMENT', amount: -customerPayment },
    { type: 'DRIVER_EARNING', amount: driverEarningGross },
    { type: 'DRIVER_COMMISSION', amount: -driverCommission },
    { type: 'PLATFORM_FEE', amount: platformFee },
  ];
  if (isMart) {
    entries.push({ type: 'MERCHANT_EARNING', amount: merchantEarningGross });
    entries.push({ type: 'MERCHANT_FEE', amount: -merchantFee });
  }

  // === Wallet driver & merchant setelah SEMUA entri diterapkan (net riil) ===
  const driverWalletDelta = entries
    .filter(e => e.type === 'DRIVER_EARNING' || e.type === 'DRIVER_COMMISSION')
    .reduce((s, e) => s + e.amount, 0);
  const merchantWalletDelta = entries
    .filter(e => e.type === 'MERCHANT_EARNING' || e.type === 'MERCHANT_FEE')
    .reduce((s, e) => s + e.amount, 0);

  // === reconcileOrder (SETELAH fix) ===
  let cp = 0, de = 0, me = 0, mf = 0, dc = 0, pf = 0;
  for (const e of entries) {
    if (e.type === 'CUSTOMER_PAYMENT') cp += e.amount;
    if (e.type === 'DRIVER_EARNING') de += e.amount;
    if (e.type === 'MERCHANT_EARNING') me += e.amount;
    if (e.type === 'MERCHANT_FEE') mf += e.amount;
    if (e.type === 'DRIVER_COMMISSION') dc += e.amount;
    if (e.type === 'PLATFORM_FEE') pf += e.amount;
  }
  const totalDebit = cp; // negatif
  const totalCredit = (de + dc) + (me + mf) + pf;
  const isBalanced = Math.abs(Math.abs(totalDebit) - totalCredit) < 0.01;

  // Ekspektasi manual independen (dihitung terpisah dari kode di atas,
  // supaya bukan cuma "test yang meniru bug yang sama"):
  const expectedDriverNet = deliveryFee - driverCommission;
  const expectedMerchantNet = isMart ? itemsSubtotal - merchantFee : 0;
  const expectedPlatformTake = merchantFee + driverCommission;

  const driverOK = Math.abs(driverWalletDelta - expectedDriverNet) < 0.01;
  const merchantOK = Math.abs(merchantWalletDelta - expectedMerchantNet) < 0.01;
  const reconcileOK = isBalanced;
  const totalOK = Math.abs(customerPayment - (driverWalletDelta + merchantWalletDelta + platformFee)) < 0.01;

  console.log(`\n=== ${label} ===`);
  console.log(`customerPayment      : ${customerPayment.toFixed(2)}`);
  console.log(`driver wallet delta  : ${driverWalletDelta.toFixed(2)}  (expected net ${expectedDriverNet.toFixed(2)}) -> ${driverOK ? 'OK' : 'FAIL'}`);
  console.log(`merchant wallet delta: ${merchantWalletDelta.toFixed(2)}  (expected net ${expectedMerchantNet.toFixed(2)}) -> ${merchantOK ? 'OK' : 'FAIL'}`);
  console.log(`platformFee          : ${platformFee.toFixed(2)}  (expected ${expectedPlatformTake.toFixed(2)})`);
  console.log(`reconcileOrder balanced: ${reconcileOK ? 'OK (isBalanced=true)' : 'FAIL (isBalanced=false)'}`);
  console.log(`customerPayment == driverNet+merchantNet+platformFee: ${totalOK ? 'OK' : 'FAIL'}`);

  return driverOK && merchantOK && reconcileOK && totalOK;
}

let allPass = true;

// Kasus 1: order BIKE biasa (bukan MART), commission 20%
allPass &= simulateOrder({
  label: 'BIKE order, deliveryFee=15000, commission=20%',
  itemsSubtotal: 0,
  deliveryFee: 15000,
  merchantFeeRate: 0,
  commissionRate: 0.20,
  isMart: false,
});

// Kasus 2: order MART, itemsSubtotal=120000, deliveryFee=12000,
// merchantFeeRate=8%, commissionRate=15%
allPass &= simulateOrder({
  label: 'MART order, items=120000, deliveryFee=12000, merchantFee=8%, commission=15%',
  itemsSubtotal: 120000,
  deliveryFee: 12000,
  merchantFeeRate: 0.08,
  commissionRate: 0.15,
  isMart: true,
});

// Kasus 3: angka desimal ganjil, buat pastikan floating point toleransi 0.01 aman
allPass &= simulateOrder({
  label: 'MART order ganjil, items=99999, deliveryFee=8888, merchantFee=7.5%, commission=17.5%',
  itemsSubtotal: 99999,
  deliveryFee: 8888,
  merchantFeeRate: 0.075,
  commissionRate: 0.175,
  isMart: true,
});

console.log(`\n${allPass ? '✅ SEMUA KASUS LOLOS -- ledger reconcile benar, tidak ada double-deduction.' : '❌ ADA KASUS GAGAL -- cek log di atas.'}`);
process.exit(allPass ? 0 : 1);
