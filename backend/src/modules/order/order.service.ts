import { OrderStatus, Prisma, ServiceType } from '@prisma/client';
import { OrderRepository } from './order.repository';
import { PromoService } from '../promo/promo.service';
import { TariffEngineService } from '../tariff/tariff.service';
import { prisma } from '../../config/prisma';
import { DispatchService } from '../dispatch/dispatch.service';
import { DispatchScheduler } from '../dispatch/dispatch.scheduler';
import { DispatchState } from '../dispatch/dispatch.state';
import { AppError, ForbiddenError, NotFoundError } from '../../core/errors/AppError';
import { SocketService } from '../../websocket/socket';
import { AuditLogger } from '../../core/logging/audit.logger';
import { PaymentService } from '../payment/payment.service';
import { logger } from '../../config/logger';
import { DriverEligibilityService } from '../driver/services/driver-eligibility.service';
import { LedgerService } from '../ledger/ledger.service';
import { getOrderNumber } from '../../core/utils/order-number';
import { DriverPickupCompensationService } from '../driver/services/driver-pickup-compensation.service';
import { WalletRepository } from '../wallet/wallet.repository';
import { calculatePlatformContribution } from '../tariff/monetization.policy';

interface CreateOrderInput {
  serviceType: 'BIKE' | 'CAR' | 'SEND' | 'MART';
  distanceKm: number;
  pickupAddress: string;
  pickupLat: number;
  pickupLng: number;
  dropoffAddress: string;
  dropoffLat: number;
  dropoffLng: number;
  zoneName?: string;
  waitMinutes?: number;
  hasToll?: boolean;
  hasParking?: boolean;
  isBadWeather?: boolean;
  isHoliday?: boolean;
  promoCode?: string;
  paymentMethod?: 'WALLET' | 'CASH' | 'QRIS' | 'TRANSFER' | 'EWALLET';
  // 🆕 MULTI-DESTINATION (Fase 1): daftar tujuan TAMBAHAN, berurutan,
  // DI LUAR `dropoffAddress/Lat/Lng` di atas. Kalau diisi (length >= 1),
  // order dianggap multi-tujuan: `dropoffAddress/Lat/Lng` di atas TETAP
  // dipakai sebagai tujuan PERTAMA, lalu setiap entri `extraStops`
  // adalah tujuan berikutnya secara berurutan. Kosong/undefined = order
  // 1-tujuan biasa, behaviour lama 100% tidak berubah.
  extraStops?: { address: string; lat: number; lng: number; note?: string }[];
  itemDescription?: string;
  packageSize?: 'SMALL' | 'MEDIUM' | 'LARGE';
  estimatedWeightKg?: number;
  handlingNotes?: string;
  vehicleRequirement?: 'AUTO' | 'BIKE' | 'CAR';
}

interface MerchantCheckoutInput {
  merchantId: string;
  items: { productId: string; quantity: number }[];
  dropoffAddress: string;
  dropoffLat: number;
  dropoffLng: number;
  paymentMethod?: 'WALLET' | 'CASH' | 'QRIS' | 'TRANSFER' | 'EWALLET';
  notes?: string;
  zoneName?: string;
  expectedTotal?: number;
}

const ALLOWED_DRIVER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING: [],
  ACCEPTED: [OrderStatus.ON_THE_WAY],
  ON_THE_WAY: [OrderStatus.ARRIVED],
  ARRIVED: [OrderStatus.PICKED_UP],
  PICKED_UP: [OrderStatus.ARRIVED_CUSTOMER],
  ARRIVED_CUSTOMER: [OrderStatus.COMPLETED],
  COMPLETED: [],
  CANCELLED: [],
};

const ORDER_PUBLICATION_TTL_MS = 30 * 60 * 1000;

export class OrderService {
  private orderRepo = new OrderRepository();
  private promoService = new PromoService();
  private tariffEngine = new TariffEngineService();
  private dispatchService = new DispatchService();
  private paymentService = new PaymentService();
  private ledgerService = new LedgerService();
  private driverEligibilityService = new DriverEligibilityService();
  private pickupCompensationService = new DriverPickupCompensationService();
  private walletRepo = new WalletRepository();

  async giveDriverTip(customerUserId: string, orderId: string, rawAmount: number) {
    const amount = Math.round(Number(rawAmount));
    if (!Number.isFinite(amount) || amount < 1000 || amount > 500000) {
      throw new AppError('Tips harus antara Rp1.000 sampai Rp500.000.', 400);
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { customer: true, driver: true },
    });
    if (!order) throw new NotFoundError('Order tidak ditemukan!');
    if (order.customer.userId !== customerUserId) throw new ForbiddenError('Order ini bukan milik Anda!');
    if (order.status !== 'COMPLETED' || !order.isPaid || order.settlementStatus !== 'SETTLED') {
      throw new AppError('Tips dapat diberikan setelah order selesai dan pembayaran utama lunas.', 409);
    }
    if (!order.driver?.userId) throw new AppError('Order tidak memiliki driver penerima tips.', 409);

    const customerWallet = await this.walletRepo.findOrCreateByUserId(customerUserId);
    const driverWallet = await this.walletRepo.findOrCreateByUserId(order.driver.userId);
    const customerReference = `order-${orderId}-tip-customer`;
    const driverReference = `order-${orderId}-tip-driver`;

    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.ledger.findUnique({ where: { reference: driverReference } });
      if (existing) throw new AppError('Tips untuk order ini sudah diberikan.', 409);

      await this.walletRepo.applyDelta(tx, customerWallet.id, -amount, 'PAYMENT', `Tips untuk driver order #${orderId}`, orderId, customerReference);
      const driverCredit = await this.walletRepo.applyDelta(tx, driverWallet.id, amount, 'EARNING', `Tips customer order #${orderId} (100% untuk driver)`, orderId, driverReference);
      await tx.ledger.createMany({ data: [
        { orderId, userId: customerUserId, type: 'CUSTOMER_TIP', amount: -amount, description: `Tips driver order #${orderId}`, reference: customerReference, metadata: { commissionable: false } },
        { orderId, userId: order.driver!.userId, type: 'DRIVER_TIP', amount, description: `Tips customer order #${orderId}`, reference: driverReference, metadata: { commissionable: false, platformFee: 0 } },
      ] });
      return driverCredit.wallet;
    });

    await AuditLogger.log(customerUserId, 'CUSTOMER_GIVE_TIP', `Memberikan tips Rp${amount} untuk driver order #${orderId}`);
    SocketService.emitToUser(order.driver.userId, 'tip_received', { orderId, amount, message: `Anda menerima tips Rp${amount.toLocaleString('id-ID')} dari customer.` });
    SocketService.emitToUser(customerUserId, 'tip_sent', { orderId, amount });
    SocketService.emitToAdmins('driver_tip_created', { orderId, amount, driverUserId: order.driver.userId });
    return { orderId, amount, driverWalletBalance: result.balance, driverEarningsBalance: result.earningsBalance };
  }

  async previewMerchantOrder(input: MerchantCheckoutInput) {
    const merchant = await prisma.merchant.findUnique({ where: { id: input.merchantId } });
    if (!merchant) throw new AppError('Toko tidak ditemukan!', 404);
    if (!merchant.isOpen) throw new AppError(`Maaf, ${merchant.name} sedang tutup.`, 400);

    const productIds = input.items.map((item) => item.productId);
    const products = await prisma.product.findMany({ where: { id: { in: productIds }, merchantId: input.merchantId } });
    let itemsSubtotal = 0;
    for (const item of input.items) {
      const product = products.find((candidate) => candidate.id === item.productId);
      if (!product || !product.isAvailable) throw new AppError('Salah satu produk tidak tersedia. Muat ulang menu toko.', 400);
      itemsSubtotal += Number(product.price) * item.quantity;
    }

    const distanceKm = await this.validateOrderDistance({
      pickupLat: merchant.latitude,
      pickupLng: merchant.longitude,
      dropoffLat: input.dropoffLat,
      dropoffLng: input.dropoffLng,
    });
    const tariff = await this.tariffEngine.calculateFare({
      serviceType: 'MART', distanceKm, zoneName: input.zoneName, waitMinutes: 0,
      hasToll: false, hasParking: false, isBadWeather: false, isHoliday: false,
      promoDiscount: 0, pickupLat: merchant.latitude, pickupLng: merchant.longitude,
      dropoffLat: input.dropoffLat, dropoffLng: input.dropoffLng,
    });
    const deliveryFee = tariff.finalFare;
    return {
      merchantId: merchant.id,
      itemsSubtotal,
      deliveryFee,
      additionalFees: tariff.tollFee + tariff.parkingFee + tariff.weatherSurcharge + tariff.holidaySurcharge,
      discount: tariff.promoDiscount,
      distanceKm,
      totalPayable: itemsSubtotal + deliveryFee,
      calculatedAt: new Date().toISOString(),
    };
  }

  // ============================================================
  // 🔒 VALIDASI JARAK - SERVER SIDE
  // ============================================================
  private async validateOrderDistance(orderData: {
    pickupLat: number;
    pickupLng: number;
    dropoffLat: number;
    dropoffLng: number;
    clientDistance?: number;
  }) {
    const { DistanceService } = await import('../../core/services/distance.service');
    const distanceService = new DistanceService();
    const result = await distanceService.getVerifiedDistance(
      orderData.pickupLat,
      orderData.pickupLng,
      orderData.dropoffLat,
      orderData.dropoffLng,
      orderData.clientDistance
    );

    if (result.error) {
      throw new AppError(result.error, 400);
    }

    if (result.manipulationSevere) {
      throw new AppError('Invalid distance data detected', 400);
    }

    return result.roadDistance || orderData.clientDistance || 0;
  }

  // ============================================================
  // 🆕 MULTI-DESTINATION: VALIDASI JARAK PER-ETAPE - SERVER SIDE
  //
  // Sama seperti `validateOrderDistance` di atas, tapi untuk RANGKAIAN
  // titik (pickup -> titik1 -> titik2 -> ...). Setiap etape divalidasi
  // TERPISAH lewat DistanceService.getVerifiedDistance yang sama persis
  // dipakai order 1-tujuan -- jadi deteksi manipulasi jarak (client
  // mengaku jarak jauh lebih pendek dari sebenarnya) tetap berlaku
  // per-etape, bukan cuma total keseluruhan (yang bisa "menyamarkan"
  // satu etape curang di antara etape-etape jujur lainnya).
  // Mengembalikan total jarak (km) hasil penjumlahan semua etape yang
  // sudah diverifikasi.
  private async validateMultiStopDistance(
    pickup: { lat: number; lng: number },
    stops: { lat: number; lng: number }[]
  ): Promise<number> {
    const { DistanceService } = await import('../../core/services/distance.service');
    const distanceService = new DistanceService();

    let totalDistance = 0;
    let prev = pickup;
    for (const stop of stops) {
      const result = await distanceService.getVerifiedDistance(prev.lat, prev.lng, stop.lat, stop.lng);
      if (result.error) {
        throw new AppError(result.error, 400);
      }
      if (result.manipulationSevere) {
        throw new AppError('Invalid distance data detected', 400);
      }
      totalDistance += result.roadDistance || 0;
      prev = stop;
    }
    return totalDistance;
  }

  // ============================================================
  // 🔒 CALCULATE ORDER BREAKDOWN UNTUK LEDGER
  //
  // 🆕 FIX BUG KRITIS (double-deduction): sebelumnya method ini
  // mengembalikan driverEarning/merchantEarning yang SUDAH NET (dikurangi
  // commission/fee), TAPI ledger.service.ts JUGA menulis entri
  // DRIVER_COMMISSION dan MERCHANT_FEE terpisah yang memotong lagi --
  // akibatnya driver & merchant kepotong komisi/fee DUA KALI setiap
  // order selesai (net = deliveryFee - 2×commission, bukan -1×commission).
  //
  // FIX: driverEarning & merchantEarning sekarang GROSS (sebelum
  // commission/fee dipotong). Pemotongannya SATU KALI SAJA, lewat entri
  // DRIVER_COMMISSION / MERCHANT_FEE terpisah di ledger. Net yang
  // benar-benar diterima driver/merchant = GROSS entry + (commission/fee
  // entry yang negatif), dihitung oleh ledger, bukan oleh method ini.
  //
  // platformFee juga diperbaiki: sebelumnya rumus ngawang
  // 'customerPayment*0.10+0.50' yang TIDAK terhubung sama sekali ke
  // merchantFeeRate/commissionRate yang benar-benar dipakai. Sekarang
  // platformFee = merchantFee + driverCommission -- persis uang yang
  // benar-benar dipotong dari merchant & driver, supaya total ledger
  // (customerPayment = driverNet + merchantNet + platformFee) reconcile.
  //
  // 🆕 FIX SNAPSHOT RATE: sebelumnya commissionRate & merchantFeeRate
  // diambil dari config TERKINI saat order COMPLETED, bukan rate yang
  // berlaku saat order DIBUAT -- kalau admin ubah tarif di antara waktu
  // order dibuat & selesai, driver/merchant bisa dibayar beda dari yang
  // dikuotasikan ke customer saat checkout.
  //
  // Ternyata TIDAK PERLU migration/kolom baru: createOrder() &
  // createMerchantOrder() SUDAH memanggil
  // tariffEngine.recordPricingHistory(order.id, breakdown) saat order
  // dibuat, dan breakdown itu SUDAH berisi commissionRate,
  // merchantFeeRate, merchantFeeAmount, itemsSubtotal (lihat
  // TariffBreakdown & PricingHistory.breakdown Json) -- snapshot-nya
  // sudah ada di database, cuma belum dipakai di sini. Sekarang method
  // ini membaca PricingHistory milik order tsb DULU; config terkini
  // cuma dipakai sebagai fallback kalau (kasus langka/order lama) tidak
  // ada PricingHistory sama sekali.
  // ============================================================
  private async calculateOrderBreakdown(orderId: string) {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        merchant: true,
        driver: true,
        orderItems: true,
        pricingHistory: true,
      },
    });

    if (!order) {
      throw new Error(`Order ${orderId} not found`);
    }

    const orderAmount = order.price.toNumber();
    const discount = order.discount.toNumber();
    const customerPayment = orderAmount - discount;

    let itemsSubtotal = 0;
    let deliveryFee = 0;

    if (order.serviceType === 'MART' && order.orderItems) {
      for (const item of order.orderItems) {
        itemsSubtotal += item.subtotal.toNumber();
      }
      deliveryFee = customerPayment - itemsSubtotal;
    } else {
      deliveryFee = customerPayment;
    }

    // 🔒 SNAPSHOT: ambil rate dari PricingHistory (rate saat order
    // DIBUAT), bukan config terkini -- kecuali order lama yang belum
    // punya PricingHistory sama sekali, baru fallback ke config saat ini.
    const snapshot = order.pricingHistory?.breakdown as
      | { commissionRate?: number; merchantFeeRate?: number; driverPickupDistanceKm?: number; driverPickupRatePerKm?: number; driverPickupCompensation?: number; driverPickupCompensationRateSource?: string }
      | null
      | undefined;

    let commissionRate: number;
    let merchantFeeRate = 0;

    if (snapshot && typeof snapshot.commissionRate === 'number') {
      commissionRate = snapshot.commissionRate;
      merchantFeeRate = order.serviceType === ServiceType.MART && typeof snapshot.merchantFeeRate === 'number'
        ? snapshot.merchantFeeRate
        : 0;
      logger.info(`[LEDGER] Order ${orderId}: pakai rate snapshot dari PricingHistory (commissionRate=${commissionRate}, merchantFeeRate=${merchantFeeRate})`);
    } else {
      // Fallback -- order tidak punya PricingHistory (kasus langka/legacy).
      const resolved = await this.tariffEngine.resolveCommissionRate(deliveryFee);
      commissionRate = resolved.rate;
      merchantFeeRate = order.serviceType === ServiceType.MART
        ? await this.tariffEngine.getMerchantPlatformFeeRate()
        : 0;
      logger.warn(`[LEDGER] Order ${orderId}: TIDAK ADA PricingHistory, pakai config TERKINI sebagai fallback (commissionRate=${commissionRate}, merchantFeeRate=${merchantFeeRate}) -- rate mungkin beda dari yang dikuotasikan ke customer saat checkout.`);
    }

    const merchantFee = order.serviceType === ServiceType.MART
      ? itemsSubtotal * merchantFeeRate
      : 0;
    const driverContribution = calculatePlatformContribution(
      order.serviceType,
      Math.max(0, deliveryFee),
      commissionRate,
    );
    const driverCommission = Math.min(Math.max(0, deliveryFee), driverContribution.contribution);

    // 🆕 GROSS, bukan net -- ledger yang memotong commission/fee-nya
    // lewat entri terpisah, satu kali saja.
    const driverEarning = deliveryFee;
    const merchantEarning = order.serviceType === 'MART' ? itemsSubtotal : 0;

    // 🆕 platformFee = uang yang BENAR-BENAR dipotong dari driver & merchant,
    // bukan rumus terpisah yang tidak terhubung ke rate sebenarnya.
    const platformFee = driverCommission + merchantFee;

    // FIX7: kompensasi driver menuju pickup adalah SUBSIDI/earning tambahan
    // platform yang di-snapshot saat order diterima. Nilai ini tidak pernah
    // masuk customerPayment/deliveryFee dan tidak dikenai driverCommission.
    const driverPickupCompensation = snapshot && typeof snapshot.driverPickupCompensation === 'number'
      ? Math.max(0, snapshot.driverPickupCompensation)
      : 0;

    return {
      orderId,
      customerPayment,
      driverEarning,
      merchantEarning,
      platformFee,
      merchantFee,
      driverCommission,
      driverPickupCompensation,
      breakdown: {
        itemsSubtotal,
        deliveryFee,
        merchantFeeRate,
        commissionRate,
        shippingFee: deliveryFee,
        paymentMethod: order.paymentMethod,
        driverPickupDistanceKm: snapshot?.driverPickupDistanceKm ?? 0,
        driverPickupRatePerKm: snapshot?.driverPickupRatePerKm ?? 0,
        driverPickupCompensationRateSource: snapshot?.driverPickupCompensationRateSource ?? 'NO_SNAPSHOT',
        rateSource: snapshot ? 'pricing_history_snapshot' : 'current_config_fallback',
      },
    };
  }

  // ============================================================
  // 🔥 CREATE ORDER
  // ============================================================
  async createOrder(userId: string, input: CreateOrderInput) {
    const customerProfile = await this.orderRepo.findCustomerProfileByUserId(userId);
    if (!customerProfile) {
      throw new ForbiddenError('Hanya pengguna terdaftar sebagai CUSTOMER yang bisa membuat order!');
    }

    const existingActiveOrder = await prisma.order.findFirst({
      where: {
        customerId: customerProfile.id,
        OR: [
          { status: { in: [OrderStatus.PENDING, OrderStatus.ACCEPTED, OrderStatus.ON_THE_WAY, OrderStatus.ARRIVED, OrderStatus.PICKED_UP, OrderStatus.ARRIVED_CUSTOMER] } },
          // FIX RC2: perjalanan fisik boleh sudah COMPLETED, tetapi untuk
          // QRIS/TRANSFER/EWALLET dashboard tetap terkunci sampai bukti bayar
          // disetujui dan settlement benar-benar SETTLED.
          {
            status: OrderStatus.COMPLETED,
            isPaid: false,
            paymentMethod: { in: ['QRIS', 'TRANSFER', 'EWALLET'] },
          },
        ],
      },
      select: { id: true, status: true, paymentMethod: true, settlementStatus: true },
    });
    if (existingActiveOrder) {
      throw new AppError(
        `Anda masih punya order yang belum selesai (#${existingActiveOrder.id.slice(0, 8)}, status ${existingActiveOrder.status}). Selesaikan atau batalkan order itu dulu sebelum membuat order baru.`,
        409
      );
    }

    const effectiveVehicleRequirement = input.serviceType === 'SEND'
      ? ((input.packageSize === 'LARGE' || Number(input.estimatedWeightKg || 0) > 20)
          ? 'CAR'
          : (input.vehicleRequirement || 'AUTO'))
      : undefined;

    // 🆕 MULTI-DESTINATION: normalisasi & validasi `extraStops` kalau ada.
    // `dropoffAddress/Lat/Lng` di input SELALU tujuan PERTAMA; setiap
    // `extraStops[i]` adalah tujuan berikutnya secara berurutan.
    const extraStops = (input.extraStops || []).filter(
      (s) => s && typeof s.lat === 'number' && typeof s.lng === 'number' && s.address
    );
    const isMultiStop = extraStops.length > 0;

    // Tujuan yang benar-benar dipakai untuk kolom `dropoffAddress/Lat/Lng`
    // di tabel Order -- tujuan PERTAMA untuk order biasa, atau tujuan
    // TERAKHIR untuk order multi-tujuan (lihat komentar di schema.prisma
    // OrderStop untuk alasan lengkapnya).
    const finalDestination = isMultiStop ? extraStops[extraStops.length - 1] : {
      address: input.dropoffAddress,
      lat: input.dropoffLat,
      lng: input.dropoffLng,
    };

    const safeDistance = isMultiStop
      ? await this.validateMultiStopDistance(
          { lat: input.pickupLat, lng: input.pickupLng },
          [
            { lat: input.dropoffLat, lng: input.dropoffLng },
            ...extraStops.map((s) => ({ lat: s.lat, lng: s.lng })),
          ]
        )
      : await this.validateOrderDistance({
          pickupLat: input.pickupLat,
          pickupLng: input.pickupLng,
          dropoffLat: input.dropoffLat,
          dropoffLng: input.dropoffLng,
          clientDistance: input.distanceKm,
        });

    const customerWallet = await prisma.wallet.findUnique({
      where: { userId: userId },
    });

    if (!customerWallet) {
      throw new AppError('Dompet tidak ditemukan! Silakan hubungi customer service.', 404);
    }

    const preDiscount = await this.tariffEngine.calculateFare({
      serviceType: input.serviceType,
      distanceKm: safeDistance,
      zoneName: input.zoneName,
      waitMinutes: input.waitMinutes,
      hasToll: input.hasToll,
      hasParking: input.hasParking,
      isBadWeather: input.isBadWeather,
      isHoliday: input.isHoliday,
      promoDiscount: 0,
      pickupLat: input.pickupLat,
      pickupLng: input.pickupLng,
      dropoffLat: input.dropoffLat,
      dropoffLng: input.dropoffLng,
      // 🆕 MULTI-DESTINATION: 0 untuk order 1-tujuan biasa (tidak
      // mempengaruhi tarif lama sama sekali).
      extraStopCount: extraStops.length,
    });
    const subtotal = preDiscount.finalFare;

    let discount = 0;
    let promoId: string | undefined;
    let promoQuota = 0;
    if (input.promoCode) {
      const promoResult = await this.promoService.validateAndPreview(input.promoCode, subtotal);
      discount = promoResult.discount;
      promoId = promoResult.promo.id;
      promoQuota = promoResult.promo.quota;
      // 🆕 Reservasi kuota ATOMIK dipindah ke DALAM $transaction yang
      // sama dengan orderRepo.create() di bawah -- lihat komentar di
      // sana untuk alasan lengkapnya ("Financial transaction boundary").
    }

    const totalPayable = subtotal - discount;
    const balance = Number(customerWallet.balance);

    if (input.paymentMethod === 'WALLET') {
      if (balance < totalPayable) {
        const shortfall = totalPayable - balance;
        throw new AppError(
          `Saldo tidak mencukupi untuk melakukan order ini.\n` +
          `💰 Saldo Anda: Rp${balance.toLocaleString('id-ID')}\n` +
          `💳 Total biaya: Rp${totalPayable.toLocaleString('id-ID')}\n` +
          `📉 Kurang: Rp${shortfall.toLocaleString('id-ID')}\n` +
          `Silakan top up saldo Anda terlebih dahulu.`,
          400
        );
      }
    } else {
      const minimumDeposit = await this.tariffEngine.getMinimumDriverDeposit();
      if (balance < minimumDeposit) {
        throw new AppError(
          `Saldo Anda (Rp${balance.toLocaleString('id-ID')}) ` +
          `belum mencapai minimum deposit Rp${minimumDeposit.toLocaleString('id-ID')} ` +
          `untuk bisa melakukan order dengan metode ${input.paymentMethod}.`,
          400
        );
      }
    }

    logger.info(`[ORDER] Validasi saldo berhasil untuk user ${userId}:`);
    logger.info(`  Saldo: Rp${balance.toLocaleString('id-ID')}`);
    logger.info(`  Total biaya: Rp${totalPayable.toLocaleString('id-ID')}`);
    logger.info(`  Metode: ${input.paymentMethod}`);

    const finalBreakdown = await this.tariffEngine.calculateFare({
      serviceType: input.serviceType,
      distanceKm: safeDistance,
      zoneName: input.zoneName,
      waitMinutes: input.waitMinutes,
      hasToll: input.hasToll,
      hasParking: input.hasParking,
      isBadWeather: input.isBadWeather,
      isHoliday: input.isHoliday,
      promoDiscount: discount,
      pickupLat: input.pickupLat,
      pickupLng: input.pickupLng,
      dropoffLat: input.dropoffLat,
      dropoffLng: input.dropoffLng,
      extraStopCount: extraStops.length,
    });

    // 🆕 FIX "Financial transaction boundary": reservasi kuota promo +
    // pembuatan order sekarang SATU transaksi DB atomik (prisma.$transaction)
    // -- sebelumnya dua operasi terpisah (reserveUsage() dulu, baru
    // orderRepo.create() belakangan tanpa jaminan apa pun di antaranya).
    // Kalau order.create() gagal karena SEBAB APAPUN (koneksi putus,
    // constraint DB lain, dst) setelah reservasi promo berhasil, TANPA
    // pembungkusan ini kuota promo tetap "terbakar" secara permanen
    // untuk order yang gagal dibuat -- tidak bisa dieksploitasi untuk
    // over-redeem (fail-safe), tapi tetap pemborosan kuota nyata yang
    // tidak perlu. Sekarang keduanya rollback bersamaan kalau salah
    // satu gagal -- benar-benar atomik, bukan cuma fail-safe.
    const order = await prisma.$transaction(async (tx) => {
      if (promoId) {
        await this.promoService.reserveUsage(promoId, promoQuota, tx);
      }

      return this.orderRepo.create({
        serviceType: input.serviceType,
        status: OrderStatus.PENDING,
        price: subtotal,
        discount,
        ...(promoId ? { promo: { connect: { id: promoId } } } : {}),
        pickupAddress: input.pickupAddress,
        pickupLat: input.pickupLat,
        pickupLng: input.pickupLng,
        // 🆕 MULTI-DESTINATION: untuk order 1-tujuan, `finalDestination`
        // sama persis dengan `input.dropoffAddress/Lat/Lng` (tidak ada
        // perubahan). Untuk order multi-tujuan, ini adalah tujuan
        // TERAKHIR -- lihat komentar di schema.prisma OrderStop.
        dropoffAddress: finalDestination.address,
        dropoffLat: finalDestination.lat,
        dropoffLng: finalDestination.lng,
        distanceKm: safeDistance,
        ...(input.serviceType === 'SEND' ? {
          itemDescription: input.itemDescription,
          packageSize: input.packageSize,
          estimatedWeightKg: input.estimatedWeightKg,
          handlingNotes: input.handlingNotes,
          vehicleRequirement: effectiveVehicleRequirement,
        } : {}),
        paymentMethod: input.paymentMethod || 'WALLET',
        customer: { connect: { id: customerProfile.id } },
        // 🆕 MULTI-DESTINATION: buat baris OrderStop HANYA kalau
        // `isMultiStop` true. Sequence 1 = tujuan pertama (dari
        // input.dropoffAddress/Lat/Lng), sequence 2..N = extraStops[0..].
        // Order 1-tujuan biasa TIDAK membuat baris OrderStop sama sekali.
        ...(isMultiStop ? {
          stops: {
            create: [
              { sequence: 1, address: input.dropoffAddress, lat: input.dropoffLat, lng: input.dropoffLng },
              ...extraStops.map((s, idx) => ({
                sequence: idx + 2,
                address: s.address,
                lat: s.lat,
                lng: s.lng,
                note: s.note,
              })),
            ],
          },
        } : {}),
      }, tx);
    });

    // 🆕 Kuota promo sudah direservasi ATOMIK bersama order.create() di
    // atas -- tidak perlu markUsed() lagi di sini.

    await this.tariffEngine.recordPricingHistory(order.id, finalBreakdown);

    await AuditLogger.log(userId, 'CREATE_ORDER', `Membuat order ${order.serviceType} #${order.id} senilai Rp${order.price}`);

    if (input.paymentMethod === 'WALLET') {
      try {
        logger.info(`[ORDER] HOLD saldo Rp${totalPayable.toLocaleString('id-ID')} untuk order #${order.id}`);
      } catch (holdError) {
        logger.error(`[ORDER] Gagal membuat HOLD untuk order #${order.id}:`, holdError);
      }
    }

    let dispatch;
    try {
      // P0 DISPATCH CONTRACT: jangan broadcast `new_order_available` ke
      // drivers_pool. Offer yang actionable HARUS hanya dikirim oleh
      // DispatchService ke driver kandidat yang benar-benar eligible.
      // Broadcast pool sebelumnya membuat semua driver membunyikan ring,
      // termasuk driver yang tidak eligible, sementara UI belum memiliki
      // offer yang bisa diterima. Ini yang membuat pengalaman ride terlihat
      // seperti "hanya ring loop".
      SocketService.emitToAdmins('order_created', { orderId: order.id, orderNumber: getOrderNumber(order.id), serviceType: order.serviceType });

      const autoAccepted = await this.tryAutoAcceptOnCreation(order.id, order.serviceType);

      if (!autoAccepted) {
        dispatch = await this.dispatchService.dispatch({ order });
      } else {
        dispatch = { status: 'AUTO_ACCEPTED' as const };
      }
    } catch (err: any) {
      // 🆕 FIX P0 "Redis/Dispatch policy production yang jelas" (audit):
      // SEBELUMNYA kegagalan dispatch (termasuk Redis fail-closed --
      // lihat dispatch.redis.ts getRedisOrThrow()) HANYA di-logger.error()
      // -- order tetap dibuat dan dikembalikan SUKSES (201) ke customer
      // seolah semuanya normal, TANPA jejak durable, TANPA alert admin,
      // TANPA mekanisme retry apa pun. Order ini akan diam-diam STUCK di
      // status PENDING TANPA PERNAH ditawarkan ke driver manapun --
      // "ilusi dispatch sehat" persis yang diperingatkan audit P0 #9,
      // sekarang makin mungkin terjadi karena Redis yang tidak
      // ready/terputus sekarang GAGAL EKSPLISIT (bukan diam-diam pakai
      // fallback yang salah secara semantik).
      //
      // Sekarang kegagalan dicatat DURABLE (AuditLogger.log -> tabel
      // ActivityLog, bisa di-query admin kapan saja) dengan action
      // khusus 'DISPATCH_FAILED', DAN dikirim alert real-time ke admin
      // yang online lewat Socket.IO -- pola yang sama persis dengan
      // 'LEDGER_RECORD_FAILED' di updateStatus() untuk kegagalan ledger.
      // Order TETAP dibuat (membatalkan order karena dispatch gagal
      // bukan solusi yang benar -- customer bisa retry manual/order-nya
      // masih valid), tapi sekarang ada jejak yang bisa ditindaklanjuti
      // admin, bukan cuma baris log yang gampang hilang.
      logger.error(`[AUTO-ACCEPT/DISPATCH] Gagal memproses order ${order.id}: ${err?.message || err}`);
      dispatch = null;
      try {
        await AuditLogger.log(
          userId,
          'DISPATCH_FAILED',
          `Order #${order.id} (${order.serviceType}) dibuat tapi gagal di-dispatch: ${err?.message || err}. PERLU DITINJAU MANUAL (order mungkin stuck tanpa driver).`
        );
        SocketService.emitToAdmins('dispatch_failed', {
          orderId: order.id,
          orderNumber: getOrderNumber(order.id),
          serviceType: order.serviceType,
          error: err?.message || String(err),
        });
      } catch {
        // Kalaupun pencatatan durable/alert-nya sendiri gagal, jangan
        // sampai menjatuhkan alur pembuatan order -- logger.error di
        // atas sudah jadi jaring pengaman terakhir.
      }
    }

    return { order: { ...order, orderNumber: getOrderNumber(order.id) }, breakdown: finalBreakdown, dispatch };
  }

  // ============================================================
  // 🆕 CHECKOUT MERCHANT (Link Merchant <-> Order)
  // ============================================================
  async createMerchantOrder(userId: string, input: MerchantCheckoutInput) {
    const customerProfile = await this.orderRepo.findCustomerProfileByUserId(userId);
    if (!customerProfile) {
      throw new ForbiddenError('Hanya pengguna terdaftar sebagai CUSTOMER yang bisa membuat order!');
    }

    if (!input.items || input.items.length === 0) {
      throw new AppError('Keranjang belanja kosong! Pilih minimal 1 produk.', 400);
    }

    const existingActiveOrder = await prisma.order.findFirst({
      where: {
        customerId: customerProfile.id,
        OR: [
          { status: { in: [OrderStatus.PENDING, OrderStatus.ACCEPTED, OrderStatus.ON_THE_WAY, OrderStatus.ARRIVED, OrderStatus.PICKED_UP, OrderStatus.ARRIVED_CUSTOMER] } },
          // FIX RC2: perjalanan fisik boleh sudah COMPLETED, tetapi untuk
          // QRIS/TRANSFER/EWALLET dashboard tetap terkunci sampai bukti bayar
          // disetujui dan settlement benar-benar SETTLED.
          {
            status: OrderStatus.COMPLETED,
            isPaid: false,
            paymentMethod: { in: ['QRIS', 'TRANSFER', 'EWALLET'] },
          },
        ],
      },
      select: { id: true, status: true, paymentMethod: true, settlementStatus: true },
    });
    if (existingActiveOrder) {
      throw new AppError(
        `Anda masih punya order yang belum selesai (#${existingActiveOrder.id.slice(0, 8)}, status ${existingActiveOrder.status}). Selesaikan atau batalkan order itu dulu sebelum membuat order baru.`,
        409
      );
    }

    const merchant = await prisma.merchant.findUnique({ where: { id: input.merchantId } });
    if (!merchant) {
      throw new AppError('Toko tidak ditemukan!', 404);
    }
    if (!merchant.isOpen) {
      throw new AppError(`Maaf, ${merchant.name} sedang tutup. Coba lagi nanti.`, 400);
    }

    const productIds = input.items.map((i) => i.productId);
    const products = await prisma.product.findMany({
      where: { id: { in: productIds }, merchantId: input.merchantId },
    });

    const orderItemsData: { productId: string; name: string; price: any; quantity: number; subtotal: number }[] = [];
    let itemsSubtotal = 0;

    for (const item of input.items) {
      if (!item.quantity || item.quantity < 1) {
        throw new AppError('Jumlah produk tidak valid!', 400);
      }
      const product = products.find((p) => p.id === item.productId);
      if (!product) {
        throw new AppError(`Produk dengan ID ${item.productId} tidak ditemukan di toko ini!`, 404);
      }
      if (!product.isAvailable) {
        throw new AppError(`"${product.name}" sedang tidak tersedia.`, 400);
      }
      const price = Number(product.price);
      const subtotal = price * item.quantity;
      itemsSubtotal += subtotal;
      orderItemsData.push({
        productId: product.id,
        name: product.name,
        price: product.price,
        quantity: item.quantity,
        subtotal,
      });
    }

    // ============================================================
    // 🔒 HITUNG ONGKIR PAKAI TARIFF ENGINE
    // ============================================================
    const { DistanceService } = await import('../../core/services/distance.service');
    const distanceService = new DistanceService();
    const distanceResult = await distanceService.getVerifiedDistance(
      merchant.latitude,
      merchant.longitude,
      input.dropoffLat,
      input.dropoffLng,
      undefined
    );

    if (distanceResult.error) {
      throw new AppError(distanceResult.error, 400);
    }

    const distanceKm = distanceResult.roadDistance || this.calculateHaversineDistance(
      merchant.latitude,
      merchant.longitude,
      input.dropoffLat,
      input.dropoffLng
    );

    const martTariff = await this.tariffEngine.calculateFare({
      serviceType: 'MART' as any,
      distanceKm: distanceKm,
      zoneName: input.zoneName,
      waitMinutes: 0,
      hasToll: false,
      hasParking: false,
      isBadWeather: false,
      isHoliday: false,
      promoDiscount: 0,
      pickupLat: merchant.latitude,
      pickupLng: merchant.longitude,
      dropoffLat: input.dropoffLat,
      dropoffLng: input.dropoffLng,
    });

    const deliveryFee = martTariff.finalFare;
    const totalPayable = itemsSubtotal + deliveryFee;

    if (input.expectedTotal !== undefined && Math.abs(input.expectedTotal - totalPayable) >= 1) {
      throw new AppError(
        `Total pesanan berubah dari Rp${input.expectedTotal.toLocaleString('id-ID')} menjadi Rp${totalPayable.toLocaleString('id-ID')}. Silakan periksa dan konfirmasi kembali.`,
        409
      );
    }

    // Monetization Architecture V1: merchant contribution dibaca dari
    // PlatformConfig dan DI-SNAPSHOT saat order dibuat. Dengan begitu fase
    // onboarding dapat memakai 0%, lalu standard 3%, tanpa settlement
    // berubah retroaktif untuk order yang sudah dibuat.
    const merchantFeeRate = await this.tariffEngine.getMerchantPlatformFeeRate();
    const merchantFeeAmount = Math.round(itemsSubtotal * merchantFeeRate);
    const { rate: driverCommissionRateOnDelivery } = await this.tariffEngine.resolveCommissionRate(deliveryFee);
    const driverContributionOnDelivery = calculatePlatformContribution(
      ServiceType.MART,
      deliveryFee,
      driverCommissionRateOnDelivery,
    );
    const driverCommissionAmount = Math.min(deliveryFee, driverContributionOnDelivery.contribution);

    const customerWallet = await prisma.wallet.findUnique({ where: { userId } });
    if (!customerWallet) {
      throw new AppError('Dompet tidak ditemukan! Silakan hubungi customer service.', 404);
    }
    const balance = Number(customerWallet.balance);
    const paymentMethod = input.paymentMethod || 'WALLET';

    if (paymentMethod === 'WALLET') {
      if (balance < totalPayable) {
        const shortfall = totalPayable - balance;
        throw new AppError(
          `Saldo tidak mencukupi untuk melakukan order ini.\n` +
            `💰 Saldo Anda: Rp${balance.toLocaleString('id-ID')}\n` +
            `💳 Total biaya: Rp${totalPayable.toLocaleString('id-ID')} (belanja Rp${itemsSubtotal.toLocaleString('id-ID')} + ongkir Rp${deliveryFee.toLocaleString('id-ID')})\n` +
            `📉 Kurang: Rp${shortfall.toLocaleString('id-ID')}\n` +
            `Silakan top up saldo Anda terlebih dahulu.`,
          400
        );
      }
    } else {
      const minimumDeposit = await this.tariffEngine.getMinimumDriverDeposit();
      if (balance < minimumDeposit) {
        throw new AppError(
          `Saldo Anda (Rp${balance.toLocaleString('id-ID')}) belum mencapai minimum deposit Rp${minimumDeposit.toLocaleString('id-ID')} untuk memakai metode ${paymentMethod}.`,
          400
        );
      }
    }

    const order = await this.orderRepo.create({
      serviceType: 'MART' as any,
      status: OrderStatus.PENDING,
      price: totalPayable,
      discount: 0,
      pickupAddress: merchant.address,
      pickupLat: merchant.latitude,
      pickupLng: merchant.longitude,
      dropoffAddress: input.dropoffAddress,
      dropoffLat: input.dropoffLat,
      dropoffLng: input.dropoffLng,
      distanceKm,
      paymentMethod,
      customer: { connect: { id: customerProfile.id } },
      merchant: { connect: { id: input.merchantId } },
      orderItems: { create: orderItemsData },
    } as any);

    await this.tariffEngine.recordPricingHistory(order.id, {
      baseFare: martTariff.baseFare,
      pickupFee: martTariff.pickupFee,
      distanceFee: martTariff.distanceFee,
      waitFee: martTariff.waitFee,
      tollFee: martTariff.tollFee,
      parkingFee: martTariff.parkingFee,
      weatherSurcharge: martTariff.weatherSurcharge,
      holidaySurcharge: martTariff.holidaySurcharge,
      // MULTI-DESTINATION: order MART biasa tidak memiliki extra stop.
      // Wajib eksplisit 0 karena TariffBreakdown mensyaratkan multiStopFee.
      multiStopFee: 0,
      promoDiscount: martTariff.promoDiscount,
      finalFare: totalPayable,
      commissionRate: driverCommissionRateOnDelivery,
      commissionAmount: driverCommissionAmount,
      driverEarning: deliveryFee - driverCommissionAmount,
      tariffVersionId: martTariff.tariffVersionId,
      zoneId: martTariff.zoneId,
      orderType: 'MART',
      itemsSubtotal,
      merchantFeeRate,
      merchantFeeAmount,
      merchantEarning: itemsSubtotal - merchantFeeAmount,
    });

    await AuditLogger.log(
      userId,
      'CREATE_MERCHANT_ORDER',
      `Checkout dari toko "${merchant.name}" — order #${order.id} senilai Rp${totalPayable} (${orderItemsData.length} item, ongkir Rp${deliveryFee}, merchant fee ${(merchantFeeRate * 100).toFixed(2)}%)`
    );

    let dispatch;
    try {
      // P0 DISPATCH CONTRACT: actionable offer dikirim hanya oleh
      // DispatchService kepada kandidat driver yang eligible. Jangan
      // broadcast ke drivers_pool karena itu memicu ring untuk semua driver.
      SocketService.emitToAdmins('order_created', { orderId: order.id, orderNumber: getOrderNumber(order.id), serviceType: order.serviceType });
      if (merchant.ownerId) {
        SocketService.emitToUser(merchant.ownerId, 'merchant_new_order', {
          orderId: order.id,
          orderNumber: getOrderNumber(order.id),
          itemCount: orderItemsData.length,
          total: totalPayable,
        });
      }

      const autoAccepted = await this.tryAutoAcceptOnCreation(order.id, order.serviceType);
      if (!autoAccepted) {
        dispatch = await this.dispatchService.dispatch({ order });
      } else {
        dispatch = { status: 'AUTO_ACCEPTED' as const };
      }
    } catch (err: any) {
      // 🆕 FIX P0 "Redis/Dispatch policy production yang jelas" (audit)
      // -- pola sama persis dengan createOrder() di atas, lihat
      // komentar lengkap di sana.
      logger.error(`[AUTO-ACCEPT/DISPATCH] Gagal memproses order MART ${order.id}: ${err?.message || err}`);
      dispatch = null;
      try {
        await AuditLogger.log(
          userId,
          'DISPATCH_FAILED',
          `Order MART #${order.id} (${order.serviceType}) dibuat tapi gagal di-dispatch: ${err?.message || err}. PERLU DITINJAU MANUAL (order mungkin stuck tanpa driver).`
        );
        SocketService.emitToAdmins('dispatch_failed', {
          orderId: order.id,
          orderNumber: getOrderNumber(order.id),
          serviceType: order.serviceType,
          error: err?.message || String(err),
        });
      } catch {
        // Jaring pengaman terakhir -- logger.error di atas sudah cukup.
      }
    }

    return { order: { ...order, orderNumber: getOrderNumber(order.id) }, breakdown: { itemsSubtotal, deliveryFee, totalPayable }, dispatch };
  }

  private calculateHaversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371;
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  // ============================================================
  // 🔒 AUTO ACCEPT - PILIH DRIVER TERDEKAT
  // ============================================================
  private async tryAutoAcceptOnCreation(orderId: string, serviceType: string): Promise<boolean> {
    logger.info(`[AUTO-ACCEPT-ON-CREATE] order ${orderId}: mencari driver terdekat...`);

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        pickupLat: true,
        pickupLng: true,
        serviceType: true,
        dropoffLat: true,
        dropoffLng: true,
        distanceKm: true,
        price: true,
        discount: true,
        vehicleRequirement: true,
      },
    });

    if (!order) {
      logger.warn(`[AUTO-ACCEPT-ON-CREATE] order ${orderId}: order tidak ditemukan`);
      return false;
    }

    const minimumDeposit = await this.tariffEngine.getMinimumDriverDeposit();

    const isSendOrMart = serviceType === 'SEND' || serviceType === 'MART';

    // 🆕 FIX "Raw SQL" (audit lanjutan): diganti dari $queryRawUnsafe
    // (string dibangun manual) ke $queryRaw tagged template -- semua
    // ${...} sekarang parameter terikat asli, bukan teks SQL yang
    // digabung. Fragment kondisional filter serviceType dibangun lewat
    // Prisma.sql/Prisma.empty, konsisten dengan job.service.ts.
    const serviceTypeFilter = isSendOrMart
      ? Prisma.empty
      : Prisma.sql`AND d."serviceType" = ${serviceType}::"ServiceType"`;

    // 🆕 FIX KRITIS "Ledger SQL schema" (pola sistemik yang sama --
    // ditemukan juga di job.service.ts & ledger.service.ts): query ini
    // sebelumnya pakai nama tabel/kolom snake_case ("driver_profiles",
    // "users", "wallets", "orders", "d.user_id", "u.is_active", dst)
    // yang SAMA SEKALI TIDAK ADA di database Postgres -- Prisma di
    // proyek ini TIDAK PERNAH pakai @@map/@map, jadi nama sungguhan
    // persis PascalCase/camelCase dari schema.prisma ("DriverProfile",
    // "User", "Wallet", "Order", "userId", "isActive", dst), wajib
    // di-quote. Query ini SELALU throw 'relation "driver_profiles" does
    // not exist' setiap dipanggil -- ARTINYA FITUR AUTO-ACCEPT ORDER
    // SAAT DIBUAT TIDAK PERNAH BERHASIL SEKALIPUN sejak awal (selalu
    // gagal diam-diam lalu fallback ke Dispatch Engine biasa -- lihat
    // catch di caller). Diperbaiki dengan quote yang benar.
    const candidates = await prisma.$queryRaw<any[]>`
      SELECT 
        d.id,
        d."userId" as "userId",
        d.latitude,
        d.longitude,
        (
          6371 * acos(
            cos(radians(${order.pickupLat})) * 
            cos(radians(d.latitude)) * 
            cos(radians(d.longitude) - radians(${order.pickupLng})) + 
            sin(radians(${order.pickupLat})) * 
            sin(radians(d.latitude))
          )
        ) * 1000 as distance_meters
      FROM "DriverProfile" d
      JOIN "User" u ON u.id = d."userId"
      WHERE 
        u."isActive" = true
        AND d."isOnline" = true
        AND d."isVerified" = true
        AND d."autoAcceptEnabled" = true
        AND d.latitude IS NOT NULL
        AND d.longitude IS NOT NULL
        ${serviceTypeFilter}
        AND (
          SELECT balance FROM "Wallet" w WHERE w."userId" = u.id
        ) >= ${minimumDeposit}
        AND NOT EXISTS (
          SELECT 1 FROM "Order" o 
          WHERE o."driverId" = d.id 
            AND o.status IN ('ACCEPTED', 'ON_THE_WAY', 'ARRIVED', 'PICKED_UP', 'ARRIVED_CUSTOMER')
        )
        AND NOT EXISTS (
          SELECT 1 FROM "Order" o 
          WHERE o."driverId" = d.id 
            AND o."paymentMethod" = 'CASH'
            AND o.status = 'COMPLETED'
            AND o."isPaid" = false
        )
      ORDER BY distance_meters ASC
      LIMIT 1
    `;

    if (!candidates || candidates.length === 0) {
      logger.info(`[AUTO-ACCEPT-ON-CREATE] order ${orderId}: 0 kandidat -- lanjut ke Dispatch Engine.`);
      return false;
    }

    const chosen = candidates[0];

    const eligibility = await this.driverEligibilityService.check({
      driverId: chosen.id,
      order: {
        serviceType: order.serviceType,
        pickupLat: order.pickupLat,
        pickupLng: order.pickupLng,
        vehicleRequirement: order.vehicleRequirement,
      },
      options: {
        minimumDeposit,
        maxDistanceKm: 3, // MONETIZATION_V1: extended radius 3km
        maxDailyOrders: 20,
        checkLocationFreshness: false,
      },
    });

    if (!eligibility.isEligible) {
      logger.warn(`[AUTO-ACCEPT-ON-CREATE] order ${orderId}: driver ${chosen.id} tidak eligible:`, eligibility.reasons);
      return false;
    }

    logger.info(`[AUTO-ACCEPT-ON-CREATE] order ${orderId}: driver terdekat ${chosen.id} pada jarak ${Math.round(chosen.distance_meters)}m`);

    // FIX7: hitung DRIVER -> PICKUP tepat dari posisi driver saat order
    // diterima. Snapshot ini disimpan atomik bersama claim, sehingga tidak
    // mungkin driver berhasil mendapat order tetapi kompensasinya hilang.
    const pickupCompensation = await this.pickupCompensationService.calculate({
      serviceType: order.serviceType,
      driverLat: Number(chosen.latitude),
      driverLng: Number(chosen.longitude),
      pickupLat: order.pickupLat,
      pickupLng: order.pickupLng,
      customerBillableDistanceKm: Number(order.distanceKm),
      customerFareAtAcceptance: Number(order.price) - Number(order.discount),
    });

    const claimCount = await prisma.$transaction(async (tx) => {
      // pg_advisory_xact_lock() bertipe PostgreSQL `void`; memilih fungsi
      // tersebut langsung membuat Prisma gagal deserialize sebelum claim.
      // CTE materialized memastikan lock tetap dieksekusi, tetapi result yang
      // dikembalikan ke Prisma hanya INTEGER yang didukung.
      await tx.$queryRaw`
        WITH driver_lock AS MATERIALIZED (
          SELECT pg_advisory_xact_lock(hashtext(${chosen.id}))
        )
        SELECT 1::INTEGER AS locked FROM driver_lock
      `;
      const concurrentActiveOrder = await tx.order.findFirst({
        where: {
          driverId: chosen.id,
          status: { in: ['ACCEPTED', 'ON_THE_WAY', 'ARRIVED', 'PICKED_UP', 'ARRIVED_CUSTOMER'] },
        },
        select: { id: true },
      });
      if (concurrentActiveOrder) return 0;

      const claim = await tx.order.updateMany({
        where: { id: orderId, status: OrderStatus.PENDING, driverId: null },
        data: { driverId: chosen.id, status: OrderStatus.ACCEPTED, acceptedAt: new Date() },
      });
      if (claim.count === 0) return 0;

      const existingPricing = await tx.pricingHistory.findUnique({ where: { orderId } });
      const currentBreakdown = (existingPricing?.breakdown as any) || {};
      await tx.pricingHistory.upsert({
        where: { orderId },
        create: { orderId, tariffVersionId: null, breakdown: pickupCompensation as any },
        update: { breakdown: { ...currentBreakdown, ...pickupCompensation } as any },
      });
      return claim.count;
    });

    if (claimCount === 0) {
      logger.warn(`[AUTO-ACCEPT-ON-CREATE] order ${orderId}: claimOrder gagal`);
      return false;
    }

    logger.info(`[AUTO-ACCEPT-ON-CREATE] order ${orderId}: BERHASIL diklaim otomatis oleh driver ${chosen.id}; pickup=${pickupCompensation.driverPickupDistanceKm}km, kompensasi=Rp${pickupCompensation.driverPickupCompensation}`);

    const updatedOrder = await this.orderRepo.findById(orderId);
    if (updatedOrder) {
      try {
        SocketService.emitToOrder(orderId, 'order_status_changed', {
          orderId,
          orderNumber: getOrderNumber(orderId),
          status: updatedOrder.status,
          driverId: chosen.id,
        });
        SocketService.emitToUser((updatedOrder as any).customer.userId, 'order_accepted', {
          orderId,
          orderNumber: getOrderNumber(orderId),
          driverId: chosen.id,
          driver: {
            fullName: (updatedOrder as any).driver?.user?.fullName,
            vehicleModel: (updatedOrder as any).driver?.vehicleModel,
            vehiclePlate: (updatedOrder as any).driver?.vehiclePlate,
          },
        });
        if (updatedOrder.serviceType === 'MART') {
          SocketService.emitToUser((updatedOrder as any).customer.userId, 'mart_driver_heading_to_merchant', {
            orderId,
            orderNumber: getOrderNumber(orderId),
            status: updatedOrder.status,
            serviceType: updatedOrder.serviceType,
            message: 'Driver sedang menuju lokasi merchant untuk mengambil pesanan Anda.',
          });
        }
        SocketService.emitToUser(chosen.userId, 'order_accepted', {
          orderId,
          orderNumber: getOrderNumber(orderId),
          driverId: chosen.id,
          status: updatedOrder.status,
          autoAccepted: true,
          order: {
            id: updatedOrder.id,
            status: updatedOrder.status,
            serviceType: updatedOrder.serviceType,
            pickupAddress: updatedOrder.pickupAddress,
            pickupLat: updatedOrder.pickupLat,
            pickupLng: updatedOrder.pickupLng,
            dropoffAddress: updatedOrder.dropoffAddress,
            dropoffLat: updatedOrder.dropoffLat,
            dropoffLng: updatedOrder.dropoffLng,
            price: updatedOrder.price,
            discount: updatedOrder.discount,
            driverPickupDistanceKm: pickupCompensation.driverPickupDistanceKm,
            driverPickupRatePerKm: pickupCompensation.driverPickupRatePerKm,
            driverPickupCompensation: pickupCompensation.driverPickupCompensation,
          },
        });
        SocketService.emitToDriversPool('order_taken', { orderId });
        SocketService.emitToAdmins('order_accepted', { orderId });
      } catch {
        // Socket.IO belum siap — abaikan.
      }
    }

    return true;
  }

  // ============================================================
  // 🔒 MANUAL ACCEPT
  // ============================================================
  async acceptOrder(userId: string, orderId: string) {
    const driverProfile = await this.orderRepo.findDriverProfileByUserId(userId);
    if (!driverProfile) {
      throw new ForbiddenError('Hanya driver terdaftar yang bisa menerima order!');
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        serviceType: true,
        pickupLat: true,
        pickupLng: true,
        dropoffLat: true,
        dropoffLng: true,
        distanceKm: true,
        price: true,
        discount: true,
        status: true,
        driverId: true,
        createdAt: true,
      },
    });

    if (!order) {
      throw new NotFoundError('Order tidak ditemukan!');
    }

    const publicationCutoff = new Date(Date.now() - ORDER_PUBLICATION_TTL_MS);
    if (order.status !== 'PENDING' || order.driverId || order.createdAt <= publicationCutoff) {
      throw new AppError('Order sudah tidak tersedia!', 409);
    }

    const minimumDeposit = await this.tariffEngine.getMinimumDriverDeposit();

    const eligibility = await this.driverEligibilityService.check({
      driverId: driverProfile.id,
      order: {
        serviceType: order.serviceType,
        pickupLat: order.pickupLat,
        pickupLng: order.pickupLng,
      },
      options: {
        minimumDeposit,
        maxDistanceKm: 3, // MONETIZATION_V1: extended radius 3km
        maxDailyOrders: 20,
        checkLocationFreshness: false,
      },
    });

    if (!eligibility.isEligible) {
      throw new ForbiddenError(
        `Driver tidak eligible: ${eligibility.reasons.join(', ')}`
      );
    }

    const pickupCompensation = await this.pickupCompensationService.calculate({
      serviceType: order.serviceType,
      driverLat: driverProfile.latitude,
      driverLng: driverProfile.longitude,
      pickupLat: order.pickupLat,
      pickupLng: order.pickupLng,
      customerBillableDistanceKm: Number(order.distanceKm),
      customerFareAtAcceptance: Number(order.price) - Number(order.discount),
    });

    const claimCount = await prisma.$transaction(async (tx) => {
      // Serialisasi claim per driver. Tanpa lock ini, dua request bersamaan
      // untuk dua order berbeda sama-sama dapat lolos cek eligibility sebelum
      // salah satunya terlihat sebagai active order (write-skew).
      await tx.$queryRaw`
        WITH driver_lock AS MATERIALIZED (
          SELECT pg_advisory_xact_lock(hashtext(${driverProfile.id}))
        )
        SELECT 1::INTEGER AS locked FROM driver_lock
      `;

      const activeOrder = await tx.order.findFirst({
        where: {
          driverId: driverProfile.id,
          status: { in: ['ACCEPTED', 'ON_THE_WAY', 'ARRIVED', 'PICKED_UP', 'ARRIVED_CUSTOMER'] },
        },
        select: { id: true },
      });
      if (activeOrder) {
        throw new AppError('Selesaikan order aktif sebelum menerima order baru!', 409);
      }

      const pendingCash = await tx.order.findFirst({
        where: { driverId: driverProfile.id, status: 'COMPLETED', paymentMethod: 'CASH', isPaid: false },
        select: { id: true },
      });
      if (pendingCash) {
        throw new AppError('Konfirmasi pembayaran CASH sebelumnya sebelum menerima order baru!', 409);
      }

      const claim = await tx.order.updateMany({
        where: {
          id: orderId,
          status: OrderStatus.PENDING,
          driverId: null,
          createdAt: { gt: publicationCutoff },
        },
        data: { driverId: driverProfile.id, status: OrderStatus.ACCEPTED, acceptedAt: new Date() },
      });
      if (claim.count === 0) return 0;

      const existingPricing = await tx.pricingHistory.findUnique({ where: { orderId } });
      const currentBreakdown = (existingPricing?.breakdown as any) || {};
      await tx.pricingHistory.upsert({
        where: { orderId },
        create: { orderId, tariffVersionId: null, breakdown: pickupCompensation as any },
        update: { breakdown: { ...currentBreakdown, ...pickupCompensation } as any },
      });
      return claim.count;
    });

    if (claimCount === 0) {
      throw new AppError('Order ini sudah diambil driver lain atau tidak tersedia lagi!', 409);
    }

    logger.info(`[PICKUP-COMP] Order ${orderId}: ${pickupCompensation.driverPickupDistanceKm}km x Rp${pickupCompensation.driverPickupRatePerKm}/km = Rp${pickupCompensation.driverPickupCompensation}`);

    const updatedOrder = await this.orderRepo.findById(orderId);
    if (!updatedOrder) {
      throw new NotFoundError('Order tidak ditemukan!');
    }

    DispatchScheduler.cancel(orderId);
    DispatchState.clear(orderId);

    await AuditLogger.log(userId, 'DRIVER_ACCEPT_ORDER', `Driver menerima order #${orderId}`);

    try {
      SocketService.emitToOrder(orderId, 'order_status_changed', {
        orderId,
        status: updatedOrder.status,
        driverId: driverProfile.id,
      });
      SocketService.emitToUser((updatedOrder as any).customer.userId, 'order_accepted', {
        orderId,
        orderNumber: getOrderNumber(updatedOrder.id),
        driverId: driverProfile.id,
        driver: {
          fullName: (updatedOrder as any).driver?.user?.fullName,
          vehicleModel: (updatedOrder as any).driver?.vehicleModel,
          vehiclePlate: (updatedOrder as any).driver?.vehiclePlate,
        },
      });
      if (updatedOrder.serviceType === 'MART') {
        SocketService.emitToUser((updatedOrder as any).customer.userId, 'mart_driver_heading_to_merchant', {
          orderId: updatedOrder.id,
          orderNumber: getOrderNumber(updatedOrder.id),
          status: updatedOrder.status,
          serviceType: updatedOrder.serviceType,
          message: 'Driver sedang menuju lokasi merchant untuk mengambil pesanan Anda.',
        });
      }
      // V4: accepting driver juga menerima event canonical yang sama.
      // Manual accept dan auto-accept kini memiliki realtime contract yang
      // konsisten; GET /jobs tetap menjadi source of truth saat reconnect.
      SocketService.emitToUser(userId, 'order_accepted', {
        orderId: updatedOrder.id,
        orderNumber: getOrderNumber(updatedOrder.id),
        driverId: driverProfile.id,
        status: updatedOrder.status,
        autoAccepted: false,
        order: {
          id: updatedOrder.id,
          status: updatedOrder.status,
          serviceType: updatedOrder.serviceType,
          pickupAddress: updatedOrder.pickupAddress,
          pickupLat: updatedOrder.pickupLat,
          pickupLng: updatedOrder.pickupLng,
          dropoffAddress: updatedOrder.dropoffAddress,
          dropoffLat: updatedOrder.dropoffLat,
          dropoffLng: updatedOrder.dropoffLng,
          price: updatedOrder.price,
          discount: updatedOrder.discount,
        },
      });
      SocketService.emitToDriversPool('order_taken', { orderId });
      SocketService.emitToAdmins('order_accepted', { orderId });
    } catch {
      // Socket.IO belum siap — abaikan.
    }

    return updatedOrder;
  }

  async listForUser(userId: string) {
    const customerProfile = await this.orderRepo.findCustomerProfileByUserId(userId);
    if (customerProfile) {
      const orders = await this.orderRepo.listForCustomer(customerProfile.id);
      return { role: 'CUSTOMER' as const, orders };
    }

    const driverProfile = await this.orderRepo.findDriverProfileByUserId(userId);
    if (driverProfile) {
      const orders = await this.orderRepo.listForDriver(driverProfile.id);
      return { role: 'DRIVER' as const, orders };
    }

    throw new NotFoundError('Profil tidak ditemukan!');
  }

  async listAvailableJobsForDriver(userId: string) {
    const driverProfile = await this.orderRepo.findDriverProfileByUserId(userId);
    if (!driverProfile) {
      throw new NotFoundError('Profil driver tidak ditemukan!');
    }
    return this.orderRepo.listAvailableAndAssignedToDriver(driverProfile.id);
  }

  // ============================================================
  // 🔥 UPDATE STATUS - DENGAN LEDGER
  // ============================================================
  async updateStopStatus(userId: string, orderId: string, stopId: string, status: 'ARRIVED' | 'COMPLETED') {
    const order = await this.orderRepo.findById(orderId);
    if (!order) throw new NotFoundError('Order tidak ditemukan!');
    if ((order as any).driver?.userId !== userId) throw new ForbiddenError('Hanya driver yang ditugaskan yang dapat memperbarui tujuan perjalanan!');
    const stops = [...((order as any).stops || [])].sort((a: any, b: any) => a.sequence - b.sequence);
    const stop = stops.find((item: any) => item.id === stopId);
    if (!stop) throw new NotFoundError('Titik tujuan tidak ditemukan!');
    if (!['PICKED_UP', 'ARRIVED_CUSTOMER'].includes(order.status)) {
      throw new AppError('Jemput customer/barang terlebih dahulu sebelum memperbarui tujuan.', 409);
    }
    const previous = stops.filter((item: any) => item.sequence < stop.sequence);
    if (previous.some((item: any) => item.status !== 'COMPLETED')) throw new AppError('Selesaikan tujuan sebelumnya terlebih dahulu.', 409);
    if (status === 'ARRIVED' && stop.status !== 'PENDING') throw new AppError('Tujuan ini tidak dapat ditandai tiba dari status sekarang.', 409);
    if (status === 'COMPLETED' && stop.status !== 'ARRIVED') throw new AppError('Tandai tiba di tujuan ini terlebih dahulu.', 409);
    const updatedStop = await prisma.$transaction(async (tx) => {
      const changedStop = await tx.orderStop.update({
        where: { id: stopId },
        data: status === 'ARRIVED' ? { status: 'ARRIVED', arrivedAt: new Date() } : { status: 'COMPLETED', completedAt: new Date() },
      });

      // Tujuan pertama tercapai setelah pickup, bukan saat driver baru tiba
      // di titik jemput. Bedakan ARRIVED (jemput) dan ARRIVED_CUSTOMER (tujuan).
      if (status === 'ARRIVED' && order.status === 'PICKED_UP') {
        await tx.order.updateMany({
          where: { id: orderId, status: OrderStatus.PICKED_UP },
          data: { status: OrderStatus.ARRIVED_CUSTOMER },
        });
      }
      return changedStop;
    });
    const updatedOrder = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: {
        stops: { orderBy: { sequence: 'asc' } },
        customer: { include: { user: { select: { fullName: true, email: true } } } },
        driver: { include: { user: { select: { fullName: true } } } },
      },
    });
    const payload = { orderId, stop: updatedStop, stops: (updatedOrder as any).stops, serviceType: updatedOrder.serviceType };
    SocketService.emitToOrder(orderId, 'order_stop_changed', payload);
    SocketService.emitToUser((order as any).customer.userId, 'order_stop_changed', payload);
    SocketService.emitToUser(userId, 'order_stop_changed', payload);
    await AuditLogger.log(userId, 'ORDER_STOP_UPDATE', `Order #${orderId} tujuan #${stop.sequence} diubah menjadi ${status}`);
    return updatedOrder;
  }

  async updateStatus(userId: string, orderId: string, status: 'ON_THE_WAY' | 'ARRIVED' | 'PICKED_UP' | 'ARRIVED_CUSTOMER' | 'COMPLETED' | 'CANCELLED') {
    const order = await this.orderRepo.findById(orderId);
    if (!order) {
      throw new NotFoundError('Order tidak ditemukan!');
    }

    const isAssignedDriver = (order as any).driver?.userId === userId;
    const isOwningCustomer = (order as any).customer.userId === userId;

    if (status === 'CANCELLED') {
      if (!isAssignedDriver && !isOwningCustomer) {
        throw new ForbiddenError('Anda tidak berhak membatalkan order ini!');
      }
      if (order.status === 'COMPLETED') {
        throw new AppError('Order yang sudah selesai tidak bisa dibatalkan!', 409);
      }

      if (isOwningCustomer && !isAssignedDriver && (order as any).acceptedAt) {
        const elapsedSeconds = (Date.now() - new Date((order as any).acceptedAt).getTime()) / 1000;
        const CANCEL_WINDOW_SECONDS = 60;
        if (elapsedSeconds > CANCEL_WINDOW_SECONDS) {
          throw new AppError(
            `Waktu pembatalan gratis (${CANCEL_WINDOW_SECONDS} detik setelah driver menerima order) sudah habis. Silakan hubungi driver langsung.`,
            403
          );
        }
      }
    } else {
      if (!isAssignedDriver) {
        throw new ForbiddenError('Hanya driver yang ditugaskan yang bisa mengubah status ini!');
      }
      const martTransitions: Record<OrderStatus, OrderStatus[]> = {
        PENDING: [],
        ACCEPTED: [OrderStatus.ON_THE_WAY],
        ON_THE_WAY: [OrderStatus.ARRIVED],
        ARRIVED: [OrderStatus.PICKED_UP],
        PICKED_UP: [OrderStatus.ARRIVED_CUSTOMER],
        ARRIVED_CUSTOMER: [OrderStatus.COMPLETED],
        COMPLETED: [],
        CANCELLED: [],
      };
      const allowedNext = order.serviceType === 'MART'
        ? (martTransitions[order.status] ?? [])
        : (ALLOWED_DRIVER_TRANSITIONS[order.status] ?? []);
      if (status === 'COMPLETED' && order.serviceType !== 'MART' && (order as any).stops?.length) {
        const unfinishedStops = (order as any).stops.filter((stop: any) => stop.status !== 'COMPLETED');
        if (unfinishedStops.length) throw new AppError('Semua tujuan harus diselesaikan sebelum order dapat ditutup.', 409);
      }
      if (!allowedNext.includes(status as OrderStatus)) {
        throw new AppError(`Status ${order.status} tidak boleh diubah langsung menjadi ${status}.`, 400);
      }
    }

    const result = await prisma.order.updateMany({
      where: { id: orderId, status: order.status },
      data: { status: status as OrderStatus },
    });

    if (result.count === 0) {
      throw new AppError('Status order sudah berubah oleh proses lain. Silakan muat ulang data.', 409);
    }

    const updatedOrder = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });

    if (status === 'CANCELLED' && order.status === 'PENDING') {
      DispatchScheduler.cancel(orderId);
      DispatchState.clear(orderId);
    }

    if (status === 'CANCELLED') {
      try {
        logger.info(`[ORDER] HOLD released untuk order #${orderId} (CANCELLED)`);
      } catch (releaseError) {
        logger.error(`[ORDER] Gagal release HOLD untuk order #${orderId}:`, releaseError);
      }
    }

    // ============================================================
    // 🔒 COMPLETED - RECORD LEDGER
    // ============================================================
    if (status === 'COMPLETED' && (updatedOrder as any).paymentMethod === 'WALLET') {
      try {
        logger.info(`[ORDER] HOLD committed untuk order #${orderId} (COMPLETED - WALLET)`);
      } catch (commitError) {
        logger.error(`[ORDER] Gagal commit HOLD untuk order #${orderId}:`, commitError);
      }

      if (!(updatedOrder as any).isPaid) {
        try {
          await this.paymentService.chargeOrder(
            (order as any).customer.userId,
            orderId,
            `auto-wallet-${orderId}`
          );
        } catch (err: any) {
          // 🆕 FIX P0 "Financial State Machine" (audit a1.4): SEBELUMNYA
          // kegagalan auto-debit HANYA memicu event Socket.IO
          // 'auto_debit_failed' -- sinyal sesaat yang HILANG kalau
          // customer sedang tidak online, TIDAK PERNAH tersimpan
          // durable di database, dan TIDAK ADA cara sistematis untuk
          // query "order mana saja yang settlement-nya masih
          // menggantung". Order tetap COMPLETED (perjalanan selesai)
          // TAPI status finansialnya jadi ambigu -- persis "keadaan
          // finansial ambigu" yang diperingatkan audit P0.
          //
          // Sekarang settlementStatus di-set EKSPLISIT ke
          // RETRY_REQUIRED (state machine terpisah dari OrderStatus --
          // lihat enum SettlementStatus di schema.prisma), DAN dicatat
          // durable lewat AuditLogger (bisa di-query admin/reconciliation
          // job kapan saja) dengan alert real-time ke admin yang online.
          // Order INI sekarang otomatis muncul di
          // ReconciliationService.listPendingReconciliation() untuk
          // di-retry -- baik manual oleh admin maupun (di masa depan)
          // oleh scheduled job.
          try {
            await prisma.order.update({
              where: { id: orderId },
              data: { settlementStatus: 'RETRY_REQUIRED' },
            });
            await AuditLogger.log(
              (order as any).customer.userId,
              'PAYMENT_SETTLEMENT_FAILED',
              `Order #${orderId} COMPLETED tapi auto-debit wallet gagal: ${err?.message || err}. settlementStatus=RETRY_REQUIRED, PERLU DIRETRY (lihat ReconciliationService).`
            );
            SocketService.emitToAdmins('payment_settlement_failed', {
              orderId,
              error: err?.message || String(err),
            });
          } catch (recordError) {
            logger.error(`[SETTLEMENT] Gagal mencatat RETRY_REQUIRED untuk order ${orderId}:`, recordError);
          }

          try {
            SocketService.emitToUser((order as any).customer.userId, 'auto_debit_failed', {
              orderId,
              error: err?.message || 'Auto debet saldo wallet gagal. Silakan cek saldo Anda.',
            });
          } catch {
            // Socket.IO belum siap — abaikan.
          }
        }
      }

      // ============================================================
      // 🔒 RECORD LEDGER UNTUK ORDER COMPLETED
      //
      // 🆕 FIX "Financial error masih ditelan setelah order COMPLETED"
      // (audit lanjutan): SEBELUMNYA kegagalan recordOrderLedger() di
      // sini HANYA di-logger.error() -- order tetap COMPLETED, uang
      // customer tetap tercharge/dianggap lunas, TAPI catatan ledger-nya
      // (satu-satunya sumber kebenaran akuntansi platform) TIDAK PERNAH
      // tertulis, dan TIDAK ADA JEJAK DURABLE APA PUN selain baris log
      // yang gampang hilang tertimbun volume log rutin -- tidak ada
      // admin yang tahu, tidak ada cara query "order mana saja yang
      // ledger-nya gagal", tidak ada retry. Ini "silent financial data
      // loss" -- order ini akan HILANG dari reconcileOrder()/
      // getPlatformRevenueSummary() TANPA JEJAK.
      //
      // Sekarang kegagalan dicatat DURABLE (AuditLogger.log -> tabel
      // ActivityLog, bukan cuma baris log) dengan action khusus
      // 'LEDGER_RECORD_FAILED' yang bisa di-query admin kapan saja,
      // DAN dikirim alert real-time ke admin yang sedang online lewat
      // Socket.IO -- supaya kegagalan ini kelihatan SAAT ITU JUGA,
      // bukan cuma ketemu kalau ada yang iseng grep log berbulan-bulan
      // kemudian. Order tetap COMPLETED (membatalkan status order
      // karena bookkeeping gagal bukan solusi yang benar -- order-nya
      // sendiri memang selesai, cuma catatannya yang perlu diperbaiki
      // manual/lewat retry job terpisah).
      // ============================================================
      try {
        const breakdown = await this.calculateOrderBreakdown(orderId);
        // 🆕 FIX KONSEPTUAL "Ledger tidak boleh menjadi mesin kedua yang
        // memindahkan saldo": chargeOrder() (dipanggil beberapa baris di
        // atas) SUDAH MEMINDAHKAN SELURUH UANG order ini secara atomik
        // (debit customer, kredit driver, kredit merchant). Panggilan
        // recordOrderLedger() di sini SEKARANG recordOnly:true -- HANYA
        // menulis baris Ledger sebagai jejak audit dari apa yang chargeOrder
        // sudah lakukan, TIDAK memindahkan wallet lagi. Sebelumnya (tanpa
        // recordOnly), driver & merchant DIKREDIT DUA KALI untuk SETIAP
        // order WALLET -- bug paling serius yang ditemukan di audit ini.
        await this.ledgerService.recordOrderLedger(breakdown, { recordOnly: true });
        logger.info(`[LEDGER] Recorded (record-only) for order ${orderId} (COMPLETED - WALLET)`);
      } catch (ledgerError: any) {
        logger.error(`[LEDGER] Failed to record for order ${orderId}:`, ledgerError);
        try {
          await AuditLogger.log(
            (order as any).customer.userId,
            'LEDGER_RECORD_FAILED',
            `Order #${orderId} (WALLET) COMPLETED tapi gagal dicatat ke ledger: ${ledgerError?.message || ledgerError}. PERLU REKONSILIASI MANUAL.`
          );
          SocketService.emitToAdmins('ledger_record_failed', {
            orderId,
            paymentMethod: 'WALLET',
            error: ledgerError?.message || String(ledgerError),
          });
        } catch {
          // Kalaupun pencatatan durable/alert-nya sendiri gagal, jangan
          // sampai menjatuhkan alur update status order -- logger.error
          // di atas sudah jadi jaring pengaman terakhir.
        }
      }
    }

    // ============================================================
    // 🔒 COMPLETED - QRIS/TRANSFER/EWALLET
    // ============================================================
    // Payment eksternal BELUM settled pada saat trip COMPLETED.
    // Tidak ada wallet mutation dan tidak ada ledger settlement di sini.
    // Settlement baru terjadi setelah bukti pembayaran disetujui Admin.

    await AuditLogger.log(
      userId,
      isOwningCustomer && status === 'CANCELLED' ? 'CUSTOMER_CANCEL_ORDER' : 'ORDER_STATUS_UPDATE',
      `Order #${orderId} status diubah menjadi ${status}`
    );

    try {
      const recipients = [(order as any).customer.userId, (order as any).driver?.userId].filter(Boolean) as string[];
      const statusPayload = {
        orderId,
        orderNumber: getOrderNumber(orderId),
        status,
        serviceType: updatedOrder.serviceType,
        pickupType: updatedOrder.serviceType === 'MART' ? 'MERCHANT' : 'CUSTOMER',
      };
      SocketService.emitToOrder(orderId, 'order_status_changed', statusPayload);
      recipients.forEach((uid) => SocketService.emitToUser(uid, 'order_status_changed', statusPayload));

      if (updatedOrder.serviceType === 'MART' && status === 'ON_THE_WAY') {
        SocketService.emitToUser((order as any).customer.userId, 'mart_driver_heading_to_merchant', {
          ...statusPayload,
          message: 'Driver sedang menuju lokasi merchant untuk mengambil pesanan Anda.',
        });
      }
      if (updatedOrder.serviceType === 'MART' && status === 'ARRIVED') {
        SocketService.emitToUser((order as any).customer.userId, 'mart_driver_arrived_at_merchant', {
          ...statusPayload,
          message: 'Driver telah tiba di lokasi merchant dan sedang mengambil pesanan Anda.',
        });
      }
      if (updatedOrder.serviceType === 'MART' && status === 'PICKED_UP') {
        SocketService.emitToUser((order as any).customer.userId, 'mart_driver_heading_to_customer', {
          ...statusPayload,
          message: 'Pesanan sudah diambil driver dan sedang menuju lokasi Anda.',
        });
      }
      if (updatedOrder.serviceType === 'MART' && status === 'ARRIVED_CUSTOMER') {
        SocketService.emitToUser((order as any).customer.userId, 'mart_driver_arrived_at_customer', {
          ...statusPayload,
          message: 'Driver telah tiba di lokasi Anda.',
        });
      }

      if (status === 'COMPLETED') {
        const externalPaymentPending = !(updatedOrder as any).isPaid && ['QRIS', 'TRANSFER', 'EWALLET'].includes((updatedOrder as any).paymentMethod);
        if (externalPaymentPending) {
          const paymentPayload = {
            orderId,
            orderNumber: getOrderNumber(orderId),
            paymentMethod: (updatedOrder as any).paymentMethod,
            message: `Perjalanan sudah tiba di tujuan. Upload bukti bayar ${(updatedOrder as any).paymentMethod} agar order dapat ditutup setelah disetujui Admin.`,
          };
          SocketService.emitToOrder(orderId, 'payment_proof_required', paymentPayload);
          SocketService.emitToUser((order as any).customer.userId, 'payment_proof_required', paymentPayload);
          if ((order as any).driver?.userId) SocketService.emitToUser((order as any).driver.userId, 'payment_pending', paymentPayload);
        } else {
          SocketService.emitToOrder(orderId, 'order_completed', { orderId });
          recipients.forEach((uid) => SocketService.emitToUser(uid, 'order_completed', { orderId }));
        }
      }
      if (status === 'CANCELLED') {
        SocketService.emitToOrder(orderId, 'order_cancelled', { orderId });
        recipients.forEach((uid) => SocketService.emitToUser(uid, 'order_cancelled', { orderId }));
      }
      SocketService.emitToAdmins('order_status_changed', { orderId, status });
    } catch {
      // Socket.IO belum siap — abaikan.
    }

    return updatedOrder;
  }

  async buildReceipt(userId: string, orderId: string) {
    const order = await this.orderRepo.findById(orderId);
    if (!order) throw new NotFoundError('Order tidak ditemukan!');

    const isOwningCustomer = (order.customer as any).userId === userId;
    if (!isOwningCustomer) {
      throw new ForbiddenError('Anda hanya bisa melihat struk untuk order milik Anda sendiri!');
    }
    if (!order.isPaid) {
      throw new AppError('Struk hanya tersedia untuk order yang sudah lunas!', 400);
    }

    const { buildReceiptHtml } = await import('./receipt.util');
    const html = buildReceiptHtml(order as any);
    return { order, html };
  }

  async sendReceipt(userId: string, orderId: string) {
    const { order, html } = await this.buildReceipt(userId, orderId);

    const { MailerService } = await import('../../config/mailer');
    const sent = await MailerService.sendReceiptEmail(
      order.customer.user.email,
      `Struk Perjalanan DHUKNOO #${order.id.slice(0, 8)}`,
      html
    );

    return { sent, receiptHtml: html };
  }

  async getChatHistory(userId: string, orderId: string) {
    const order = await this.orderRepo.findById(orderId) as any;
    if (!order) throw new NotFoundError('Order tidak ditemukan!');

    const isOwningCustomer = order.customer?.userId === userId;
    const isAssignedDriver = order.driver?.userId === userId;
    if (!isOwningCustomer && !isAssignedDriver) {
      throw new ForbiddenError('Anda tidak berhak melihat chat order ini!');
    }

    const messages = await prisma.chatMessage.findMany({
      where: { orderId },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });

    return messages.map((m) => ({
      sender: m.senderId,
      senderRole: m.senderRole,
      message: m.message,
      sentAt: m.createdAt.toISOString(),
    }));
  }
}
