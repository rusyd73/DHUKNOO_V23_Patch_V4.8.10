import { prisma } from '../../config/prisma';
import { calculatePlatformContribution } from '../tariff/monetization.policy';

export type RecapTimeframe = 'daily' | 'weekly' | 'monthly';

/**
 * Query rekapitulasi platform (pelanggan, mitra driver + perolehan, transaksi,
 * revenue platform) untuk suatu rentang waktu. Diekstrak dari route handler
 * GET /api/admin/recap supaya bisa dipakai ULANG oleh endpoint export
 * PDF/Excel — sebelumnya query sepanjang ~180 baris ini hanya ada di satu
 * tempat (inline di route), yang kalau di-copy-paste ke endpoint baru akan
 * jadi dua sumber kebenaran yang gampang saling menyimpang (pola bug yang
 * berulang kali ditemukan di project ini).
 */
export async function buildAdminRecap(timeframe: RecapTimeframe = 'daily') {
  const now = new Date();
  let startDate = new Date();

  if (timeframe === 'weekly') {
    startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  } else if (timeframe === 'monthly') {
    startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  } else {
    startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  }

  // 1. Pelanggan terdaftar lengkap identitas dan no HP
  const customers = await prisma.customerProfile.findMany({
    where: { createdAt: { gte: startDate } },
    include: {
      user: { select: { fullName: true, email: true, createdAt: true } },
      orders: { select: { id: true, price: true, status: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  const allCustomers =
    customers.length > 0
      ? customers
      : await prisma.customerProfile.findMany({
          include: {
            user: { select: { fullName: true, email: true, createdAt: true } },
            orders: { select: { id: true, price: true, status: true } },
          },
          orderBy: { createdAt: 'desc' },
        });

  const formattedCustomers = allCustomers.map((c) => ({
    id: c.id,
    fullName: c.user.fullName,
    email: c.user.email,
    phoneNumber: c.phoneNumber || '081234567890',
    registeredAt: c.createdAt,
    totalOrders: c.orders.length,
    isAppInstalled: c.isAppInstalled,
  }));

  // 3. Merchant terdaftar: identitas usaha, pemilik, lokasi, dan status.
  // Status operasional memakai Merchant.isOpen; status akun pemilik memakai User.isActive.
  // Keduanya ditampilkan terpisah agar Admin dapat membedakan toko tutup dengan akun pemilik nonaktif.
  const merchants = await prisma.merchant.findMany({
    include: {
      owner: { select: { fullName: true, email: true, isActive: true } },
      _count: { select: { products: true, orders: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  const formattedMerchants = merchants.map((m) => ({
    id: m.id,
    name: m.name,
    ownerName: m.owner?.fullName || 'Belum terhubung',
    ownerEmail: m.owner?.email || '-',
    category: m.category,
    address: m.address,
    latitude: m.latitude,
    longitude: m.longitude,
    phone: m.phone || '-',
    isOpen: m.isOpen,
    ownerIsActive: m.owner?.isActive ?? false,
    status: !m.owner ? 'NO_OWNER' : !m.owner.isActive ? 'OWNER_INACTIVE' : m.isOpen ? 'ACTIVE' : 'INACTIVE',
    registeredAt: m.createdAt,
    productCount: m._count.products,
    orderCount: m._count.orders,
  }));

  const merchantSummary = {
    total: formattedMerchants.length,
    active: formattedMerchants.filter((m) => m.status === 'ACTIVE').length,
    inactive: formattedMerchants.filter((m) => m.status === 'INACTIVE').length,
    ownerInactive: formattedMerchants.filter((m) => m.status === 'OWNER_INACTIVE').length,
    noOwner: formattedMerchants.filter((m) => m.status === 'NO_OWNER').length,
    registeredInTimeframe: formattedMerchants.filter((m) => new Date(m.registeredAt) >= startDate).length,
  };

  // Ledger adalah sumber kebenaran nominal aktual. Jangan hitung ulang dengan
  // komisi tetap karena rate sudah dikunci per order pada saat checkout.
  const financialLedger = await prisma.ledger.findMany({
    where: {
      createdAt: { gte: startDate },
      type: { in: ['DRIVER_EARNING', 'DRIVER_COMMISSION', 'DRIVER_TIP', 'DRIVER_PICKUP_COMPENSATION', 'PLATFORM_FEE', 'PLATFORM_PICKUP_SUBSIDY'] },
    },
    select: { orderId: true, userId: true, type: true, amount: true },
  });
  const driverEarningsByUser = new Map<string, number>();
  const grossPlatformContributionByOrder = new Map<string, number>();
  const pickupSubsidyByOrder = new Map<string, number>();
  const driverPickupCompensationByOrder = new Map<string, number>();
  for (const entry of financialLedger) {
    const amount = Number(entry.amount);
    if (entry.type === 'DRIVER_EARNING' || entry.type === 'DRIVER_COMMISSION' || entry.type === 'DRIVER_TIP') {
      driverEarningsByUser.set(entry.userId, (driverEarningsByUser.get(entry.userId) || 0) + amount);
    }
    if (entry.type === 'PLATFORM_FEE' && entry.orderId) {
      grossPlatformContributionByOrder.set(
        entry.orderId,
        (grossPlatformContributionByOrder.get(entry.orderId) || 0) + Math.max(0, amount),
      );
    }
    if (entry.type === 'PLATFORM_PICKUP_SUBSIDY' && entry.orderId) {
      pickupSubsidyByOrder.set(
        entry.orderId,
        (pickupSubsidyByOrder.get(entry.orderId) || 0) + Math.abs(amount),
      );
    }
    if (entry.type === 'DRIVER_PICKUP_COMPENSATION' && entry.orderId) {
      driverPickupCompensationByOrder.set(
        entry.orderId,
        (driverPickupCompensationByOrder.get(entry.orderId) || 0) + Math.max(0, amount),
      );
    }
  }

  // 2. Mitra pengemudi identitas, no HP, sekaligus perolehannya
  const drivers = await prisma.driverProfile.findMany({
    include: {
      user: { select: { fullName: true, email: true, createdAt: true } },
      orders: {
        where: { status: 'COMPLETED', createdAt: { gte: startDate } },
        select: { id: true, price: true, discount: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  // 3. Volume transaksi dari mana kemana oleh siapa
  const orders = await prisma.order.findMany({
    where: { createdAt: { gte: startDate } },
    include: {
      customer: { include: { user: { select: { fullName: true, email: true } } } },
      driver: { include: { user: { select: { fullName: true, email: true } } } },
      pricingHistory: true,
      orderItems: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  const activeOrdersList =
    orders.length > 0
      ? orders
      : await prisma.order.findMany({
          take: 50,
          include: {
            customer: { include: { user: { select: { fullName: true, email: true } } } },
            driver: { include: { user: { select: { fullName: true, email: true } } } },
            pricingHistory: true,
            orderItems: true,
          },
          orderBy: { createdAt: 'desc' },
        });

  // Rekonsiliasi order historis yang sudah SETTLED sebelum ledger CASH
  // mencatat split lengkap. Jangan menebak memakai tarif aktif sekarang:
  // gunakan PricingHistory yang dikunci saat checkout. Order yang sudah
  // memiliki DRIVER_EARNING/DRIVER_COMMISSION di ledger tidak dihitung lagi.
  const ordersWithDriverLedger = new Set(
    financialLedger
      .filter((entry) => entry.orderId && (entry.type === 'DRIVER_EARNING' || entry.type === 'DRIVER_COMMISSION'))
      .map((entry) => entry.orderId as string)
  );
  for (const order of activeOrdersList) {
    if (
      order.status !== 'COMPLETED' ||
      !(order.isPaid || order.settlementStatus === 'SETTLED') ||
      !order.driver?.userId ||
      ordersWithDriverLedger.has(order.id)
    ) continue;

    const snapshot = order.pricingHistory?.breakdown as any;
    const netPrice = Math.max(0, Number(order.price) - Number(order.discount || 0));
    const itemsSubtotal = order.serviceType === 'MART'
      ? Number(snapshot?.itemsSubtotal ?? order.orderItems.reduce((sum, item) => sum + Number(item.subtotal), 0))
      : 0;
    const deliveryFee = Math.max(0, netPrice - itemsSubtotal);
    const commissionRate = Math.max(0, Number(snapshot?.commissionRate ?? 0));
    const historicalContribution = Math.min(
      deliveryFee,
      calculatePlatformContribution(order.serviceType, deliveryFee, commissionRate).contribution,
    );
    const driverNet = Math.max(0, deliveryFee - historicalContribution);
    driverEarningsByUser.set(
      order.driver.userId,
      (driverEarningsByUser.get(order.driver.userId) || 0) + driverNet
    );
  }

  const formattedDrivers = drivers.map((d) => ({
    id: d.id,
    fullName: d.user.fullName,
    email: d.user.email,
    phoneNumber: d.phoneNumber || '081987654321',
    vehiclePlate: d.vehiclePlate,
    vehicleModel: d.vehicleModel,
    isVerified: d.isVerified,
    isOnline: d.isOnline,
    completedOrdersCount: d.orders.length,
    perolehan: Math.max(0, driverEarningsByUser.get(d.userId) || 0),
    registeredAt: d.createdAt,
  }));

  const formattedTransactions = activeOrdersList.map((o) => ({
    id: o.id,
    serviceType: o.serviceType,
    pickupAddress: o.pickupAddress,
    dropoffAddress: o.dropoffAddress,
    customerName: o.customer?.user?.fullName || 'Pelanggan DHUKNOO',
    customerPhone: o.customer?.phoneNumber || '081234567890',
    driverName: o.driver?.user?.fullName || 'Mitra Pengemudi',
    driverPhone: o.driver?.phoneNumber || '081987654321',
    driverPlate: o.driver?.vehiclePlate || 'N/A',
    price: Number(o.price),
    discount: Number(o.discount || 0),
    status: o.status,
    // BARU: metode pembayaran & status lunas — supaya arus kas QRIS/Transfer/
    // E-wallet (bukan cuma cash/wallet) kelihatan jelas di rekapitulasi.
    paymentMethod: o.paymentMethod,
    isPaid: o.isPaid,
    createdAt: o.createdAt,
  }));

  // 4. Platform revenue dari mana kemana oleh siapa
  const completedOrdersForRevenue = activeOrdersList.filter(
    (o) => o.status === 'COMPLETED' && (o.isPaid || o.settlementStatus === 'SETTLED')
  );
  const formattedRevenues = completedOrdersForRevenue.map((o) => {
    const grossPrice = Number(o.price);
    const discount = Number(o.discount || 0);
    const netPrice = Math.max(0, grossPrice - discount);
    const snapshot = o.pricingHistory?.breakdown as any;
    const itemsSubtotal = o.serviceType === 'MART'
      ? Number(snapshot?.itemsSubtotal ?? o.orderItems.reduce((sum, item) => sum + Number(item.subtotal), 0))
      : 0;
    const deliveryFee = Math.max(0, netPrice - itemsSubtotal);
    const commissionRate = Math.max(0, Number(snapshot?.commissionRate ?? 0));
    // Ledger tetap sumber utama. Fallback snapshot untuk order historis juga
    // WAJIB memakai MONETIZATION_V1 yang sama dengan settlement: percentage
    // vs minimum platform contribution + merchant fee snapshot. Jangan pernah
    // kembali ke `deliveryFee * rate` karena itu mengabaikan floor per service.
    const driverContribution = Math.min(
      deliveryFee,
      calculatePlatformContribution(o.serviceType, deliveryFee, commissionRate).contribution,
    );
    const merchantFee = o.serviceType === 'MART'
      ? Math.max(0, Number(snapshot?.merchantFeeAmount ?? Math.round(itemsSubtotal * Math.max(0, Number(snapshot?.merchantFeeRate ?? 0)))))
      : 0;
    const snapshotGrossContribution = driverContribution + merchantFee;
    const grossPlatformContribution = Math.max(
      0,
      grossPlatformContributionByOrder.get(o.id) ?? snapshotGrossContribution,
    );
    // Pickup subsidy memakai urutan SoT yang tahan partial-ledger:
    // 1) PLATFORM_PICKUP_SUBSIDY (pasangan debit platform yang canonical),
    // 2) DRIVER_PICKUP_COMPENSATION dari Ledger bila sisi platform historis
    //    belum tercatat,
    // 3) snapshot PricingHistory yang dikunci saat driver menerima order.
    // Dengan demikian Dashboard Admin tidak kembali ke Rp0 hanya karena
    // satu sisi pasangan ledger historis belum ada.
    const snapshotPickupCompensation = Math.max(0, Number(snapshot?.driverPickupCompensation ?? 0));
    const pickupSubsidy = Math.max(
      0,
      pickupSubsidyByOrder.get(o.id)
        ?? driverPickupCompensationByOrder.get(o.id)
        ?? snapshotPickupCompensation,
    );
    const netPlatformContribution = grossPlatformContribution - pickupSubsidy;

    return {
      id: o.id,
      serviceType: o.serviceType,
      pickupAddress: o.pickupAddress,
      dropoffAddress: o.dropoffAddress,
      customerName: o.customer?.user?.fullName || 'Pelanggan DHUKNOO',
      driverName: o.driver?.user?.fullName || 'Mitra Pengemudi',
      distanceKm: Number(o.distanceKm || 0),
      grossPrice,
      discount,
      netPrice,
      // `platformRevenue` adalah revenue NET yang benar-benar tersisa bagi
      // platform setelah pickup subsidy. Gross dan subsidy tetap tersedia
      // sebagai field eksplisit untuk audit/reconciliation.
      platformRevenue: netPlatformContribution,
      grossPlatformContribution,
      pickupSubsidy,
      netPlatformContribution,
      itemsSubtotal,
      deliveryFee,
      createdAt: o.createdAt,
    };
  });

  const totalGrossPlatformContribution = formattedRevenues.reduce((acc, curr) => acc + curr.grossPlatformContribution, 0);
  const totalPickupSubsidy = formattedRevenues.reduce((acc, curr) => acc + curr.pickupSubsidy, 0);
  const totalNetPlatformContribution = formattedRevenues.reduce((acc, curr) => acc + curr.netPlatformContribution, 0);
  // `totalPlatformRevenue` adalah NET revenue agar kartu Dashboard Utama,
  // tabel rekap dan export memakai definisi accounting yang sama.
  // Gross/subsidy tetap dilaporkan terpisah untuk audit.
  const totalPlatformRevenue = totalNetPlatformContribution;
  const totalVolumeValue = formattedTransactions.reduce((acc, curr) => acc + curr.price, 0);

  // BARU: breakdown arus kas per metode pembayaran (CASH/WALLET/QRIS/TRANSFER/
  // EWALLET) — sebelumnya rekap cuma total gabungan semua metode jadi satu
  // angka, tidak kelihatan berapa yang masuk lewat QRIS/transfer/e-wallet
  // secara terpisah dari cash/wallet.
  const paymentMethodBreakdown = (['CASH', 'WALLET', 'QRIS', 'TRANSFER', 'EWALLET'] as const).map((method) => {
    const txs = formattedTransactions.filter((t) => t.paymentMethod === method);
    return {
      method,
      count: txs.length,
      totalValue: txs.reduce((sum, t) => sum + t.price, 0),
    };
  });

  // Pencairan adalah arus keluar dana mitra, bukan pengurang revenue komisi
  // platform. Karena itu dilaporkan sebagai bagian tersendiri agar Admin dapat
  // merekonsiliasi dana ditahan, payout berhasil, serta refund otomatis.
  const withdrawals = await prisma.withdrawalRequest.findMany({
    where: { createdAt: { gte: startDate } },
    include: { user: { select: { fullName: true, email: true, role: true } } },
    orderBy: { createdAt: 'desc' },
  });
  const formattedWithdrawals = withdrawals.map((w) => ({
    id: w.id,
    userId: w.userId,
    userName: w.user.fullName,
    userEmail: w.user.email,
    role: w.user.role,
    amount: Number(w.amount),
    method: w.method,
    destinationProvider: w.destinationProvider,
    destinationAccount: w.destinationAccount,
    destinationName: w.destinationName,
    status: w.status,
    payoutProvider: w.payoutProvider,
    providerStatus: w.providerStatus,
    payoutReference: w.payoutReference,
    externalPayoutId: w.externalPayoutId,
    failureCode: w.failureCode,
    createdAt: w.createdAt,
    completedAt: w.completedAt,
  }));
  const withdrawalSummary = {
    count: formattedWithdrawals.length,
    totalRequested: formattedWithdrawals.reduce((sum, w) => sum + w.amount, 0),
    totalProcessing: formattedWithdrawals.filter((w) => ['PENDING_REVIEW', 'PENDING_TRANSFER', 'APPROVED', 'PROCESSING'].includes(w.status)).reduce((sum, w) => sum + w.amount, 0),
    totalCompleted: formattedWithdrawals.filter((w) => w.status === 'COMPLETED').reduce((sum, w) => sum + w.amount, 0),
    totalFailedRefunded: formattedWithdrawals.filter((w) => ['FAILED', 'REJECTED'].includes(w.status)).reduce((sum, w) => sum + w.amount, 0),
  };

  return {
    timeframe,
    summary: {
      totalCustomersCount: formattedCustomers.length,
      totalDriversCount: formattedDrivers.length,
      totalTransactionsCount: formattedTransactions.length,
      totalVolumeValue,
      totalPlatformRevenue,
      totalGrossPlatformContribution,
      totalPickupSubsidy,
      totalNetPlatformContribution,
      totalMerchantsCount: merchantSummary.total,
      activeMerchantsCount: merchantSummary.active,
      inactiveMerchantsCount: merchantSummary.inactive,
      ownerInactiveMerchantsCount: merchantSummary.ownerInactive,
      merchantsRegisteredInTimeframe: merchantSummary.registeredInTimeframe,
      totalWithdrawalRequested: withdrawalSummary.totalRequested,
      totalWithdrawalProcessing: withdrawalSummary.totalProcessing,
      totalWithdrawalCompleted: withdrawalSummary.totalCompleted,
      totalWithdrawalFailedRefunded: withdrawalSummary.totalFailedRefunded,
    },
    customers: formattedCustomers,
    drivers: formattedDrivers,
    merchants: formattedMerchants,
    merchantSummary,
    transactions: formattedTransactions,
    platformRevenues: formattedRevenues,
    paymentMethodBreakdown,
    withdrawals: formattedWithdrawals,
    withdrawalSummary,
  };
}

export type AdminRecap = Awaited<ReturnType<typeof buildAdminRecap>>;
