import { prisma } from '../../config/prisma';

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

  const formattedDrivers = drivers.map((d) => {
    const totalEarnings = d.orders.reduce((sum, o) => {
      const net = Number(o.price) - Number(o.discount || 0);
      const driverNet = Math.round(net * 0.92); // 92% bagian driver (8% komisi platform)
      return sum + driverNet;
    }, 0);

    return {
      id: d.id,
      fullName: d.user.fullName,
      email: d.user.email,
      phoneNumber: d.phoneNumber || '081987654321',
      vehiclePlate: d.vehiclePlate,
      vehicleModel: d.vehicleModel,
      isVerified: d.isVerified,
      isOnline: d.isOnline,
      completedOrdersCount: d.orders.length,
      perolehan: totalEarnings,
      registeredAt: d.createdAt,
    };
  });

  // 3. Volume transaksi dari mana kemana oleh siapa
  const orders = await prisma.order.findMany({
    where: { createdAt: { gte: startDate } },
    include: {
      customer: { include: { user: { select: { fullName: true, email: true } } } },
      driver: { include: { user: { select: { fullName: true, email: true } } } },
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
          },
          orderBy: { createdAt: 'desc' },
        });

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
  const completedOrdersForRevenue = activeOrdersList.filter((o) => o.status === 'COMPLETED');
  const formattedRevenues = (completedOrdersForRevenue.length > 0 ? completedOrdersForRevenue : activeOrdersList).map((o) => {
    const grossPrice = Number(o.price);
    const discount = Number(o.discount || 0);
    const netPrice = Math.max(0, grossPrice - discount);
    const platformRevenue = Math.round(netPrice * 0.08); // 8% komisi platform DHUKNOO

    return {
      id: o.id,
      serviceType: o.serviceType,
      pickupAddress: o.pickupAddress,
      dropoffAddress: o.dropoffAddress,
      customerName: o.customer?.user?.fullName || 'Pelanggan DHUKNOO',
      driverName: o.driver?.user?.fullName || 'Mitra Pengemudi',
      grossPrice,
      discount,
      netPrice,
      platformRevenue,
      createdAt: o.createdAt,
    };
  });

  const totalPlatformRevenue = formattedRevenues.reduce((acc, curr) => acc + curr.platformRevenue, 0);
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

  return {
    timeframe,
    summary: {
      totalCustomersCount: formattedCustomers.length,
      totalDriversCount: formattedDrivers.length,
      totalTransactionsCount: formattedTransactions.length,
      totalVolumeValue,
      totalPlatformRevenue,
    },
    customers: formattedCustomers,
    drivers: formattedDrivers,
    transactions: formattedTransactions,
    platformRevenues: formattedRevenues,
    paymentMethodBreakdown,
  };
}

export type AdminRecap = Awaited<ReturnType<typeof buildAdminRecap>>;
