import { PrismaClient, Role, ServiceType, OrderStatus, PromoType, TransactionType } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seeding...');

  // Clean up existing data in proper order (respecting foreign keys)
  await prisma.activityLog.deleteMany();
  await prisma.pricingHistory.deleteMany();
  await prisma.review.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.order.deleteMany();
  await prisma.promo.deleteMany();
  await prisma.product.deleteMany();
  await prisma.merchant.deleteMany();
  await prisma.wallet.deleteMany();
  await prisma.customerProfile.deleteMany();
  await prisma.driverProfile.deleteMany();
  await prisma.user.deleteMany();
  await prisma.pricingRule.deleteMany();
  await prisma.regionalPolicy.deleteMany();
  await prisma.pricingZone.deleteMany();
  await prisma.tariffVersion.deleteMany();
  await prisma.platformConfig.deleteMany();

  console.log('🧹 Existing database cleaned up.');

  // Create password hashes
  const salt = await bcrypt.genSalt(10);
  const adminHash = await bcrypt.hash('admin123', salt);
  const customerHash = await bcrypt.hash('customer123', salt);
  const driverHash = await bcrypt.hash('driver123', salt);

  // 1. Seed ADMIN
  const adminUser = await prisma.user.create({
    data: {
      email: 'admin@dhuknooride.com',
      fullName: 'Otoritas Pusat DHUKNOO',
      passwordHash: adminHash,
      role: Role.ADMIN,
    },
  });
  console.log(`👤 Seeded Admin: ${adminUser.email}`);

  // Seed wallets for Admin
  await prisma.wallet.create({
    data: {
      userId: adminUser.id,
      balance: 10000000.00,
    },
  });

  // 2. Seed CUSTOMERS
  const customer1 = await prisma.user.create({
    data: {
      email: 'customer1@gmail.com',
      fullName: 'Budi Santoso',
      passwordHash: customerHash,
      role: Role.CUSTOMER,
    },
  });
  const customer1Profile = await prisma.customerProfile.create({
    data: {
      userId: customer1.id,
      phoneNumber: '+628123456789',
      isAppInstalled: true,
    },
  });
  await prisma.wallet.create({
    data: {
      userId: customer1.id,
      balance: 150000.00,
    },
  });

  const customer2 = await prisma.user.create({
    data: {
      email: 'customer2@gmail.com',
      fullName: 'Siti Rahma',
      passwordHash: customerHash,
      role: Role.CUSTOMER,
    },
  });
  const customer2Profile = await prisma.customerProfile.create({
    data: {
      userId: customer2.id,
      phoneNumber: '+628987654321',
      isAppInstalled: true,
    },
  });
  await prisma.wallet.create({
    data: {
      userId: customer2.id,
      balance: 75000.00,
    },
  });
  console.log(`👤 Seeded Customers: ${customer1.email}, ${customer2.email}`);

  // ============================================================
  // 3. Seed DRIVERS
  // ============================================================
  
  // 3a. Driver BIKE (sudah ada)
  const driver1 = await prisma.user.create({
    data: {
      email: 'driver1@gmail.com',
      fullName: 'Slamet Ojek',
      passwordHash: driverHash,
      role: Role.DRIVER,
    },
  });
  const driver1Profile = await prisma.driverProfile.create({
    data: {
      userId: driver1.id,
      phoneNumber: '+6281234567890',
      vehiclePlate: 'N 1234 BAT',
      vehicleModel: 'Honda Vario 150',
      serviceType: ServiceType.BIKE, // ✅ Tambahkan serviceType
      isOnline: true,
      autoAcceptEnabled: true, // ✅ Auto accept aktif
      latitude: -7.8712,
      longitude: 112.5268,
      isVerified: true,
    },
  });
  await prisma.wallet.create({
    data: {
      userId: driver1.id,
      balance: 180000.00,
    },
  });
  console.log(`👤 Seeded Driver BIKE: ${driver1.email}`);

  // 3b. Driver CAR (BARU!)
  const driver2 = await prisma.user.create({
    data: {
      email: 'drivercar@dhuknoo.com',
      fullName: 'Rian Mobil',
      passwordHash: driverHash,
      role: Role.DRIVER,
    },
  });
  const driver2Profile = await prisma.driverProfile.create({
    data: {
      userId: driver2.id,
      phoneNumber: '+6289876543210',
      vehiclePlate: 'N 8888 MLG',
      vehicleModel: 'Toyota Avanza',
      serviceType: ServiceType.CAR, // ✅ CAR
      isOnline: true, // ✅ Online
      autoAcceptEnabled: true, // ✅ Auto accept aktif
      latitude: -7.9829,
      longitude: 112.6308,
      isVerified: true, // ✅ Verified
    },
  });
  await prisma.wallet.create({
    data: {
      userId: driver2.id,
      balance: 500000.00,
    },
  });
  console.log(`👤 Seeded Driver CAR: ${driver2.email}`);

  // 3c. Driver SEND (BARU!)
  const driver3 = await prisma.user.create({
    data: {
      email: 'driversend@dhuknoo.com',
      fullName: 'Agus Pickup',
      passwordHash: driverHash,
      role: Role.DRIVER,
    },
  });
  const driver3Profile = await prisma.driverProfile.create({
    data: {
      userId: driver3.id,
      phoneNumber: '+6281112223334',
      vehiclePlate: 'N 5678 MLG',
      vehicleModel: 'Mitsubishi L300',
      serviceType: ServiceType.SEND, // ✅ SEND
      isOnline: true, // ✅ Online
      autoAcceptEnabled: true, // ✅ Auto accept aktif
      latitude: -7.8750,
      longitude: 112.5350,
      isVerified: true, // ✅ Verified
    },
  });
  await prisma.wallet.create({
    data: {
      userId: driver3.id,
      balance: 300000.00,
    },
  });
  console.log(`👤 Seeded Driver SEND: ${driver3.email}`);

  // 4. Seed an Active Order
  const activeOrder = await prisma.order.create({
    data: {
      serviceType: ServiceType.BIKE,
      status: OrderStatus.PENDING,
      price: 15000.00,
      pickupAddress: 'Alun-alun Kota Batu',
      pickupLat: -7.8712,
      pickupLng: 112.5268,
      dropoffAddress: 'Museum Angkut Batu',
      dropoffLat: -7.8794,
      dropoffLng: 112.5218,
      customerId: customer1Profile.id,
    },
  });
  console.log(`📦 Seeded active pending order: ${activeOrder.id}`);

  // 4b. Seed a sample promo code
  const promo = await prisma.promo.create({
    data: {
      code: 'DHUKNOO10',
      type: PromoType.PERCENTAGE,
      value: 10,
      maxDiscount: 5000,
      minOrderPrice: 10000,
      quota: 100,
      usedCount: 0,
      isActive: true,
    },
  });
  console.log(`🎟️  Seeded promo code: ${promo.code}`);

  // 4c. Seed a COMPLETED + PAID order
  const completedOrder = await prisma.order.create({
    data: {
      serviceType: ServiceType.BIKE,
      status: OrderStatus.COMPLETED,
      price: 20000.0,
      discount: 0,
      isPaid: true,
      pickupAddress: 'Terminal Batu',
      pickupLat: -7.8718,
      pickupLng: 112.5326,
      dropoffAddress: 'Jatim Park 2',
      dropoffLat: -7.8865,
      dropoffLng: 112.5253,
      distanceKm: 3.4,
      paymentMethod: 'WALLET',
      customerId: customer2Profile.id,
      driverId: driver1Profile.id,
    },
  });

  const customer2Wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: customer2.id } });
  const driver1Wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: driver1.id } });

  await prisma.transaction.create({
    data: {
      walletId: customer2Wallet.id,
      type: TransactionType.PAYMENT,
      amount: -20000.0,
      description: `Pembayaran order #${completedOrder.id}`,
      orderId: completedOrder.id,
      idempotencyKey: `seed-${completedOrder.id}-debit`,
    },
  });
  await prisma.transaction.create({
    data: {
      walletId: driver1Wallet.id,
      type: TransactionType.EARNING,
      amount: 16000.0,
      description: `Pendapatan order #${completedOrder.id} (setelah komisi platform 20%)`,
      orderId: completedOrder.id,
      idempotencyKey: `seed-${completedOrder.id}-credit`,
    },
  });

  await prisma.review.create({
    data: {
      orderId: completedOrder.id,
      driverId: driver1Profile.id,
      rating: 5,
      comment: 'Driver ramah dan tepat waktu, jalan pintas Batu-nya oke banget!',
    },
  });
  console.log(`💳 Seeded completed+paid order with review: ${completedOrder.id}`);

  // 6. Seed sample merchants + menu items
  const merchantHash = await bcrypt.hash('merchant123', salt);
  const merchantOwner = await prisma.user.create({
    data: {
      email: 'merchant1@gmail.com',
      fullName: 'Pak Karto',
      passwordHash: merchantHash,
      role: Role.MERCHANT,
    },
  });
  await prisma.wallet.create({ data: { userId: merchantOwner.id, balance: 0.0 } });

  const merchant1 = await prisma.merchant.create({
    data: {
      name: 'Warung Bakso Pak Karto',
      category: 'Kuliner',
      address: 'Jl. Diponegoro No. 12, Batu',
      latitude: -7.8703,
      longitude: 112.5281,
      phone: '+628111222333',
      isOpen: true,
      ownerId: merchantOwner.id,
      products: {
        create: [
          { name: 'Bakso Urat Spesial', price: 18000, description: 'Bakso urat besar + mie + pangsit' },
          { name: 'Mie Ayam Bakso', price: 16000, description: 'Mie ayam dengan tambahan bakso' },
        ],
      },
    },
  });

  const merchant2 = await prisma.merchant.create({
    data: {
      name: 'Toko Oleh-Oleh Batu Asli',
      category: 'Oleh-oleh',
      address: 'Jl. Raya Selecta No. 5, Batu',
      latitude: -7.8631,
      longitude: 112.5192,
      phone: '+628222333444',
      isOpen: true,
      products: {
        create: [
          { name: 'Keripik Apel 250gr', price: 25000, description: 'Keripik apel renyah khas Batu' },
          { name: 'Sari Apel Botol', price: 12000, description: 'Minuman sari apel segar' },
        ],
      },
    },
  });
  console.log(`🏪 Seeded merchants: ${merchant1.name}, ${merchant2.name}`);

  // 5. Seed audit logs
  await prisma.activityLog.createMany({
    data: [
      {
        userId: adminUser.id,
        action: 'SYSTEM_STARTUP',
        details: 'Admin user successfully initialized during system seeding.',
      },
      {
        userId: customer1.id,
        action: 'ACCOUNT_CREATED',
        details: 'Customer profile registered and wallet generated.',
      },
      {
        userId: driver1.id,
        action: 'DRIVER_VERIFICATION_SUCCESS',
        details: 'Driver profile auto-verified and vehicle details checked.',
      },
    ],
  });
  console.log('📝 Seeded system activity logs.');

  // 7. Seed Tariff Engine
  const zoneBatu = await prisma.pricingZone.create({ data: { name: 'Kota Batu' } });
  const zoneMalang = await prisma.pricingZone.create({ data: { name: 'Malang Kota' } });

  await prisma.pricingRule.createMany({
    data: [
      { zoneId: null, serviceType: ServiceType.BIKE, baseFare: 5000, pickupFee: 1000, perKmFee: 2000, perMinuteWaitFee: 200 },
      { zoneId: null, serviceType: ServiceType.CAR, baseFare: 15000, pickupFee: 2000, perKmFee: 3500, perMinuteWaitFee: 300 },
      { zoneId: null, serviceType: ServiceType.SEND, baseFare: 8000, pickupFee: 1000, perKmFee: 2500, perMinuteWaitFee: 200 },
      { zoneId: zoneBatu.id, serviceType: ServiceType.BIKE, baseFare: 4000, pickupFee: 1000, perKmFee: 1800, perMinuteWaitFee: 200 },
      { zoneId: zoneMalang.id, serviceType: ServiceType.BIKE, baseFare: 6000, pickupFee: 1500, perKmFee: 2200, perMinuteWaitFee: 250 },
    ],
  });
  console.log('💲 Seeded PricingRule untuk BIKE/CAR/SEND/MART (fallback + zona Batu & Malang).');

  await prisma.regionalPolicy.create({
    data: {
      zoneId: zoneMalang.id,
      tollFee: 15000,
      parkingFee: 3000,
      weatherSurcharge: 5000,
      holidaySurcharge: 8000,
    },
  });
  console.log('🌦️  Seeded RegionalPolicy untuk Malang Kota.');

  const tariffVersion = await prisma.tariffVersion.create({
    data: {
      versionName: 'v2026-07-fair-tiered-commission',
      description: 'Komisi platform tiered berdasarkan nilai order',
      commissionTiers: [
        { maxOrderValue: 20000, rate: 0.08 },
        { maxOrderValue: 50000, rate: 0.07 },
        { maxOrderValue: 100000, rate: 0.06 },
        { maxOrderValue: null, rate: 0.05 },
      ],
      isActive: true,
      activatedAt: new Date(),
    },
  });
  console.log(`⚖️  Seeded TariffVersion: ${tariffVersion.versionName}`);

  await prisma.platformConfig.create({
    data: {
      key: 'MINIMUM_DRIVER_DEPOSIT',
      value: '20000',
      description: 'Saldo wallet minimum yang wajib dimiliki driver sebelum bisa menerima order (Rupiah).',
    },
  });
  console.log('⚙️  Seeded PlatformConfig: MINIMUM_DRIVER_DEPOSIT = Rp20.000');

  // ============================================================
  // ✅ SUMMARY DRIVERS
  // ============================================================
  console.log('\n📋 DRIVER SUMMARY:');
  console.log('====================================');
  const allDrivers = await prisma.driverProfile.findMany({
    include: {
      user: {
        select: {
          email: true,
          fullName: true,
        }
      }
    }
  });

  allDrivers.forEach(driver => {
    console.log(`- ${driver.user.fullName} (${driver.serviceType})`);
    console.log(`  Email: ${driver.user.email}`);
    console.log(`  Vehicle: ${driver.vehicleModel} (${driver.vehiclePlate})`);
    console.log(`  Status: ${driver.isOnline ? '🟢 ONLINE' : '🔴 OFFLINE'}`);
    console.log(`  Auto Accept: ${driver.autoAcceptEnabled ? '✅ ON' : '❌ OFF'}`);
    console.log(`  Verified: ${driver.isVerified ? '✅' : '❌'}`);
    console.log('---');
  });

  console.log('\n✅ Database seeded successfully!');
  console.log('\n🔑 Login Credentials:');
  console.log('====================================');
  console.log('Admin:   admin@dhuknooride.com / admin123');
  console.log('BIKE:    driver1@gmail.com / driver123');
  console.log('CAR:     drivercar@dhuknoo.com / driver123');
  console.log('SEND:    driversend@dhuknoo.com / driver123');
  console.log('Customer: customer1@gmail.com / customer123');
}

main()
  .catch((e) => {
    console.error('❌ Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });