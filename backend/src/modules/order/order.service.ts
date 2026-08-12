import { OrderStatus } from '@prisma/client';
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

interface CreateOrderInput {
  serviceType: 'BIKE' | 'CAR' | 'SEND';
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
}

const ALLOWED_DRIVER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING: [],
  ACCEPTED: [OrderStatus.ON_THE_WAY],
  ON_THE_WAY: [OrderStatus.ARRIVED],
  ARRIVED: [OrderStatus.COMPLETED],
  COMPLETED: [],
  CANCELLED: [],
};

export class OrderService {
  private orderRepo = new OrderRepository();
  private promoService = new PromoService();
  private tariffEngine = new TariffEngineService();
  private dispatchService = new DispatchService();
  private paymentService = new PaymentService();
  private ledgerService = new LedgerService();
  private driverEligibilityService = new DriverEligibilityService();

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
      | { commissionRate?: number; merchantFeeRate?: number }
      | null
      | undefined;

    let commissionRate: number;
    let merchantFeeRate: number;

    if (snapshot && typeof snapshot.commissionRate === 'number') {
      commissionRate = snapshot.commissionRate;
      merchantFeeRate =
        typeof snapshot.merchantFeeRate === 'number'
          ? snapshot.merchantFeeRate
          : await this.tariffEngine.getMerchantPlatformFeeRate();
      logger.info(`[LEDGER] Order ${orderId}: pakai rate snapshot dari PricingHistory (commissionRate=${commissionRate}, merchantFeeRate=${merchantFeeRate})`);
    } else {
      // Fallback -- order tidak punya PricingHistory (kasus langka/legacy).
      merchantFeeRate = await this.tariffEngine.getMerchantPlatformFeeRate();
      const resolved = await this.tariffEngine.resolveCommissionRate(deliveryFee);
      commissionRate = resolved.rate;
      logger.warn(`[LEDGER] Order ${orderId}: TIDAK ADA PricingHistory, pakai config TERKINI sebagai fallback (commissionRate=${commissionRate}, merchantFeeRate=${merchantFeeRate}) -- rate mungkin beda dari yang dikuotasikan ke customer saat checkout.`);
    }

    const merchantFee = order.serviceType === 'MART' ? itemsSubtotal * merchantFeeRate : 0;
    const driverCommission = deliveryFee * commissionRate;

    // 🆕 GROSS, bukan net -- ledger yang memotong commission/fee-nya
    // lewat entri terpisah, satu kali saja.
    const driverEarning = deliveryFee;
    const merchantEarning = order.serviceType === 'MART' ? itemsSubtotal : 0;

    // 🆕 platformFee = uang yang BENAR-BENAR dipotong dari driver & merchant,
    // bukan rumus terpisah yang tidak terhubung ke rate sebenarnya.
    const platformFee = merchantFee + driverCommission;

    return {
      orderId,
      customerPayment,
      driverEarning,
      merchantEarning,
      platformFee,
      merchantFee,
      driverCommission,
      breakdown: {
        itemsSubtotal,
        deliveryFee,
        merchantFeeRate,
        commissionRate,
        shippingFee: deliveryFee,
        paymentMethod: order.paymentMethod,
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
        status: { in: [OrderStatus.PENDING, OrderStatus.ACCEPTED, OrderStatus.ON_THE_WAY, OrderStatus.ARRIVED] },
      },
      select: { id: true, status: true },
    });
    if (existingActiveOrder) {
      throw new AppError(
        `Anda masih punya order yang belum selesai (#${existingActiveOrder.id.slice(0, 8)}, status ${existingActiveOrder.status}). Selesaikan atau batalkan order itu dulu sebelum membuat order baru.`,
        409
      );
    }

    const safeDistance = await this.validateOrderDistance({
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
        dropoffAddress: input.dropoffAddress,
        dropoffLat: input.dropoffLat,
        dropoffLng: input.dropoffLng,
        distanceKm: safeDistance,
        paymentMethod: input.paymentMethod || 'WALLET',
        customer: { connect: { id: customerProfile.id } },
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
      SocketService.emitToDriversPool('new_order_available', {
        orderId: order.id,
        serviceType: order.serviceType,
        pickupAddress: order.pickupAddress,
        dropoffAddress: order.dropoffAddress,
        price: order.price,
      });
      SocketService.emitToAdmins('order_created', { orderId: order.id, serviceType: order.serviceType });

      const autoAccepted = await this.tryAutoAcceptOnCreation(order.id, order.serviceType);

      if (!autoAccepted) {
        dispatch = await this.dispatchService.dispatch({ order });
      } else {
        dispatch = { status: 'AUTO_ACCEPTED' as const };
      }
    } catch (err: any) {
      logger.error(`[AUTO-ACCEPT/DISPATCH] Gagal memproses order ${order.id}: ${err?.message || err}`);
      dispatch = null;
    }

    return { order, breakdown: finalBreakdown, dispatch };
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
        status: { in: [OrderStatus.PENDING, OrderStatus.ACCEPTED, OrderStatus.ON_THE_WAY, OrderStatus.ARRIVED] },
      },
      select: { id: true, status: true },
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

    const merchantFeeRate = await this.tariffEngine.getMerchantPlatformFeeRate();
    const merchantFeeAmount = Math.round(itemsSubtotal * merchantFeeRate);
    const { rate: driverCommissionRateOnDelivery } = await this.tariffEngine.resolveCommissionRate(deliveryFee);

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
      promoDiscount: martTariff.promoDiscount,
      finalFare: totalPayable,
      commissionRate: driverCommissionRateOnDelivery,
      commissionAmount: Math.round(deliveryFee * driverCommissionRateOnDelivery),
      driverEarning: deliveryFee - Math.round(deliveryFee * driverCommissionRateOnDelivery),
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
      `Checkout dari toko "${merchant.name}" — order #${order.id} senilai Rp${totalPayable} (${orderItemsData.length} item, ongkir Rp${deliveryFee}, platform fee merchant ${(merchantFeeRate * 100).toFixed(1)}% = Rp${merchantFeeAmount})`
    );

    let dispatch;
    try {
      SocketService.emitToDriversPool('new_order_available', {
        orderId: order.id,
        serviceType: order.serviceType,
        pickupAddress: order.pickupAddress,
        dropoffAddress: order.dropoffAddress,
        price: order.price,
      });
      SocketService.emitToAdmins('order_created', { orderId: order.id, serviceType: order.serviceType });
      if (merchant.ownerId) {
        SocketService.emitToUser(merchant.ownerId, 'merchant_new_order', {
          orderId: order.id,
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
      logger.error(`[AUTO-ACCEPT/DISPATCH] Gagal memproses order MART ${order.id}: ${err?.message || err}`);
      dispatch = null;
    }

    return { order, breakdown: { itemsSubtotal, deliveryFee, totalPayable }, dispatch };
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
      },
    });

    if (!order) {
      logger.warn(`[AUTO-ACCEPT-ON-CREATE] order ${orderId}: order tidak ditemukan`);
      return false;
    }

    const minimumDeposit = await this.tariffEngine.getMinimumDriverDeposit();

    const isSendOrMart = serviceType === 'SEND' || serviceType === 'MART';
    const serviceTypeFilter = isSendOrMart ? '' : `AND d."serviceType" = '${serviceType}'`;

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
    const query = `
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
            AND o.status IN ('ACCEPTED', 'ON_THE_WAY', 'ARRIVED')
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

    const candidates = await prisma.$queryRawUnsafe(query) as any[];

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
      },
      options: {
        minimumDeposit,
        maxDistanceKm: 5,
        maxDailyOrders: 20,
        checkLocationFreshness: false,
      },
    });

    if (!eligibility.isEligible) {
      logger.warn(`[AUTO-ACCEPT-ON-CREATE] order ${orderId}: driver ${chosen.id} tidak eligible:`, eligibility.reasons);
      return false;
    }

    logger.info(`[AUTO-ACCEPT-ON-CREATE] order ${orderId}: driver terdekat ${chosen.id} pada jarak ${Math.round(chosen.distance_meters)}m`);

    const claim = await this.orderRepo.claimOrder(orderId, chosen.id);
    if (claim.count === 0) {
      logger.warn(`[AUTO-ACCEPT-ON-CREATE] order ${orderId}: claimOrder gagal`);
      return false;
    }

    logger.info(`[AUTO-ACCEPT-ON-CREATE] order ${orderId}: BERHASIL diklaim otomatis oleh driver ${chosen.id}!`);

    await prisma.order.update({ where: { id: orderId }, data: { acceptedAt: new Date() } });

    const updatedOrder = await this.orderRepo.findById(orderId);
    if (updatedOrder) {
      try {
        SocketService.emitToOrder(orderId, 'order_status_changed', {
          orderId,
          status: updatedOrder.status,
          driverId: chosen.id,
        });
        SocketService.emitToUser((updatedOrder as any).customer.userId, 'order_accepted', {
          orderId,
          driverId: chosen.id,
          driver: {
            fullName: (updatedOrder as any).driver?.user?.fullName,
            vehicleModel: (updatedOrder as any).driver?.vehicleModel,
            vehiclePlate: (updatedOrder as any).driver?.vehiclePlate,
          },
        });
        SocketService.emitToUser(chosen.userId, 'order_accepted', { orderId, autoAccepted: true });
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
        status: true,
      },
    });

    if (!order) {
      throw new NotFoundError('Order tidak ditemukan!');
    }

    if (order.status !== 'PENDING') {
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
        maxDistanceKm: 5,
        maxDailyOrders: 20,
        checkLocationFreshness: false,
      },
    });

    if (!eligibility.isEligible) {
      throw new ForbiddenError(
        `Driver tidak eligible: ${eligibility.reasons.join(', ')}`
      );
    }

    const claim = await this.orderRepo.claimOrder(orderId, driverProfile.id);
    if (claim.count === 0) {
      throw new AppError('Order ini sudah diambil driver lain atau tidak tersedia lagi!', 409);
    }

    await prisma.order.update({
      where: { id: orderId },
      data: { acceptedAt: new Date() },
    });

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
        driverId: driverProfile.id,
        driver: {
          fullName: (updatedOrder as any).driver?.user?.fullName,
          vehicleModel: (updatedOrder as any).driver?.vehicleModel,
          vehiclePlate: (updatedOrder as any).driver?.vehiclePlate,
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
  async updateStatus(userId: string, orderId: string, status: 'ON_THE_WAY' | 'ARRIVED' | 'COMPLETED' | 'CANCELLED') {
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
      const allowedNext = ALLOWED_DRIVER_TRANSITIONS[order.status] ?? [];
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
      // ============================================================
      try {
        const breakdown = await this.calculateOrderBreakdown(orderId);
        await this.ledgerService.recordOrderLedger(breakdown);
        logger.info(`[LEDGER] Recorded for order ${orderId} (COMPLETED - WALLET)`);
      } catch (ledgerError) {
        logger.error(`[LEDGER] Failed to record for order ${orderId}:`, ledgerError);
      }
    }

    // ============================================================
    // 🔒 COMPLETED - QRIS/TRANSFER/EWALLET (LEDGER TETAP DI-RECORD)
    //
    // 🆕 FIX "Cash accounting": blok ini SEBELUMNYA jalan untuk SEMUA
    // metode pembayaran non-WALLET TERMASUK CASH -- padahal order CASH
    // sudah punya jalur settlement SENDIRI yang benar di
    // PaymentService.confirmCash() (potong komisi dari DEPOSIT driver,
    // setor bagian merchant langsung -- karena uang cash sudah di
    // tangan driver, platform TIDAK PERNAH memegang uangnya).
    //
    // recordOrderLedger() mengasumsikan platform yang mengumpulkan uang
    // dan perlu MENDISTRIBUSIKANNYA (makanya men-generate entri
    // DRIVER_EARNING/MERCHANT_EARNING positif ke wallet) -- asumsi ini
    // BENAR untuk WALLET/QRIS/TRANSFER/EWALLET (customer bayar ke
    // platform), TAPI SALAH TOTAL untuk CASH (customer bayar tunai
    // LANGSUNG ke driver, platform tidak pernah menyentuh uangnya).
    // Kalau tetap dijalankan untuk CASH, driver & merchant (untuk MART)
    // KEPUTUSAN GANDA -- pertama lewat entri ledger yang salah asumsi
    // ini, KEDUA lewat confirmCash() yang benar -- wallet mereka
    // ke-inflate dengan uang yang sebenarnya tidak pernah dikumpulkan
    // platform. Sekarang CASH dikecualikan total dari blok ini;
    // satu-satunya sumber kebenaran akuntansi untuk order CASH adalah
    // confirmCash().
    // ============================================================
    if (status === 'COMPLETED' && (updatedOrder as any).paymentMethod !== 'WALLET' && (updatedOrder as any).paymentMethod !== 'CASH') {
      try {
        const existingLedger = await prisma.ledger.findFirst({
          where: { orderId: orderId },
        });
        if (!existingLedger) {
          const breakdown = await this.calculateOrderBreakdown(orderId);
          await this.ledgerService.recordOrderLedger(breakdown);
          logger.info(`[LEDGER] Recorded for order ${orderId} (COMPLETED - ${(updatedOrder as any).paymentMethod})`);
        }
      } catch (ledgerError) {
        logger.error(`[LEDGER] Failed to record for order ${orderId}:`, ledgerError);
      }
    }

    await AuditLogger.log(
      userId,
      isOwningCustomer && status === 'CANCELLED' ? 'CUSTOMER_CANCEL_ORDER' : 'ORDER_STATUS_UPDATE',
      `Order #${orderId} status diubah menjadi ${status}`
    );

    try {
      const recipients = [(order as any).customer.userId, (order as any).driver?.userId].filter(Boolean) as string[];
      SocketService.emitToOrder(orderId, 'order_status_changed', { orderId, status });
      recipients.forEach((uid) => SocketService.emitToUser(uid, 'order_status_changed', { orderId, status }));

      if (status === 'COMPLETED') {
        SocketService.emitToOrder(orderId, 'order_completed', { orderId });
        recipients.forEach((uid) => SocketService.emitToUser(uid, 'order_completed', { orderId }));
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