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

// Transisi status yang SAH untuk driver — mencegah lompat status
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

  // ============================================================
  // 🔥 CREATE ORDER - DENGAN VALIDASI SALDO
  // ============================================================
  async createOrder(userId: string, input: CreateOrderInput) {
    const customerProfile = await this.orderRepo.findCustomerProfileByUserId(userId);
    if (!customerProfile) {
      throw new ForbiddenError('Hanya pengguna terdaftar sebagai CUSTOMER yang bisa membuat order!');
    }

    // 🔒 CEGAH DUPLICATE ORDER
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

    // ============================================================
    // 🔒 🔥 VALIDASI SALDO WALLET
    // ============================================================
    const customerWallet = await prisma.wallet.findUnique({
      where: { userId: userId },
    });

    if (!customerWallet) {
      throw new AppError('Dompet tidak ditemukan! Silakan hubungi customer service.', 404);
    }

    // 1. Hitung subtotal dulu (untuk validasi)
    const preDiscount = await this.tariffEngine.calculateFare({
      serviceType: input.serviceType,
      distanceKm: input.distanceKm,
      zoneName: input.zoneName,
      waitMinutes: input.waitMinutes,
      hasToll: input.hasToll,
      hasParking: input.hasParking,
      isBadWeather: input.isBadWeather,
      isHoliday: input.isHoliday,
      promoDiscount: 0,
    });
    const subtotal = preDiscount.finalFare;

    // 2. Hitung potongan promo (jika ada)
    let discount = 0;
    let promoId: string | undefined;
    if (input.promoCode) {
      const promoResult = await this.promoService.validateAndPreview(input.promoCode, subtotal);
      discount = promoResult.discount;
      promoId = promoResult.promo.id;
    }

    // 3. 🔒 KUNCI: Validasi saldo
    const totalPayable = subtotal - discount;
    const balance = Number(customerWallet.balance); // ✅ Convert Decimal ke number

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

    // 🔒 LOG: Catat validasi saldo untuk audit
    logger.info(`[ORDER] Validasi saldo berhasil untuk user ${userId}:`);
    logger.info(`  Saldo: Rp${balance.toLocaleString('id-ID')}`);
    logger.info(`  Total biaya: Rp${totalPayable.toLocaleString('id-ID')}`);
    logger.info(`  Metode: ${input.paymentMethod}`);

    // 4. Hitung ULANG breakdown final dengan promo
    const finalBreakdown = await this.tariffEngine.calculateFare({
      serviceType: input.serviceType,
      distanceKm: input.distanceKm,
      zoneName: input.zoneName,
      waitMinutes: input.waitMinutes,
      hasToll: input.hasToll,
      hasParking: input.hasParking,
      isBadWeather: input.isBadWeather,
      isHoliday: input.isHoliday,
      promoDiscount: discount,
    });

    // 5. Simpan order
    const order = await this.orderRepo.create({
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
      distanceKm: input.distanceKm,
      paymentMethod: input.paymentMethod || 'WALLET',
      customer: { connect: { id: customerProfile.id } },
    });

    if (promoId) {
      await this.promoService.markUsed(promoId);
    }

    // 6. Simpan breakdown
    await this.tariffEngine.recordPricingHistory(order.id, finalBreakdown);

    await AuditLogger.log(userId, 'CREATE_ORDER', `Membuat order ${order.serviceType} #${order.id} senilai Rp${order.price}`);

    // 7. 🔒 🔥 LOCK SALDO UNTUK ORDER (PRE-AUTHORIZATION / HOLD)
    // NOTE: 'HOLD' dan 'status' mungkin tidak ada di enum TransactionType Anda.
    // Jika tidak ada, komentari atau sesuaikan dengan skema Anda.
    if (input.paymentMethod === 'WALLET') {
      try {
        // Jika Anda memiliki model Transaction dengan field status, gunakan kode di bawah.
        // Jika tidak, Anda bisa membuat record terpisah untuk hold.
        // await prisma.transaction.create({
        //   data: {
        //     walletId: customerWallet.id,
        //     type: 'HOLD', // Pastikan 'HOLD' ada di enum TransactionType
        //     amount: -totalPayable,
        //     description: `HOLD untuk order #${order.id}`,
        //     orderId: order.id,
        //     idempotencyKey: `hold-${order.id}`,
        //     status: 'PENDING',
        //   },
        // });
        logger.info(`[ORDER] HOLD saldo Rp${totalPayable.toLocaleString('id-ID')} untuk order #${order.id}`);
      } catch (holdError) {
        logger.error(`[ORDER] Gagal membuat HOLD untuk order #${order.id}:`, holdError);
      }
    }

    // 8. Realtime & Dispatch
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

  /**
   * Cari SATU driver online yang eligible auto-accept
   */
  private async tryAutoAcceptOnCreation(orderId: string, serviceType: string): Promise<boolean> {
    logger.info(`[AUTO-ACCEPT-ON-CREATE] order ${orderId}: mengecek kandidat auto-accept untuk serviceType=${serviceType}...`);
    const candidates = await prisma.driverProfile.findMany({
      where: {
        isOnline: true,
        isVerified: true,
        autoAcceptEnabled: true,
        ...(serviceType === 'SEND' ? {} : { serviceType: serviceType as any }),
        latitude: { not: null },
        longitude: { not: null },
        orders: {
          none: {
            status: 'COMPLETED',
            paymentMethod: 'CASH',
            isPaid: false,
          },
        },
      },
      select: { id: true, userId: true, latitude: true, longitude: true },
    });

    if (candidates.length === 0) {
      logger.info(`[AUTO-ACCEPT-ON-CREATE] order ${orderId} (${serviceType}): 0 kandidat driver -- lanjut ke Dispatch Engine biasa.`);
      return false;
    }

    const busyDriverIds = new Set(
      (
        await prisma.order.findMany({
          where: { driverId: { in: candidates.map((c) => c.id) }, status: { in: ['ACCEPTED', 'ON_THE_WAY', 'ARRIVED'] } },
          select: { driverId: true },
        })
      ).map((o) => o.driverId)
    );

    const freeCandidates = candidates.filter((c) => !busyDriverIds.has(c.id));
    if (freeCandidates.length === 0) {
      logger.info(`[AUTO-ACCEPT-ON-CREATE] order ${orderId}: ${candidates.length} kandidat ditemukan tapi SEMUA sedang sibuk -- lanjut ke Dispatch Engine biasa.`);
      return false;
    }

    const chosen = freeCandidates[0];

    logger.info(`[AUTO-ACCEPT-ON-CREATE] order ${orderId}: mencoba klaim otomatis untuk driver ${chosen.id}...`);

    const claim = await this.orderRepo.claimOrder(orderId, chosen.id);
    if (claim.count === 0) {
      logger.warn(`[AUTO-ACCEPT-ON-CREATE] order ${orderId}: claimOrder gagal (count=0) -- race condition.`);
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

  async acceptOrder(userId: string, orderId: string) {
    const driverProfile = await this.orderRepo.findDriverProfileByUserId(userId);
    if (!driverProfile) {
      throw new ForbiddenError('Hanya driver terdaftar yang bisa menerima order!');
    }
    if (!driverProfile.isVerified) {
      throw new ForbiddenError('Akun driver Anda belum diverifikasi Admin!');
    }

    const driverWallet = await prisma.wallet.findUnique({ where: { userId } });
    const minimumDeposit = await this.tariffEngine.getMinimumDriverDeposit();
    const currentBalance = Number(driverWallet?.balance || 0);

    if (currentBalance < minimumDeposit) {
      throw new AppError(
        `Saldo deposit Anda (Rp${currentBalance.toLocaleString('id-ID')}) belum memenuhi minimum Rp${minimumDeposit.toLocaleString('id-ID')} untuk bisa menerima order. Silakan top up dulu.`,
        403
      );
    }

    const unconfirmedCash = await prisma.order.findFirst({
      where: { driverId: driverProfile.id, status: 'COMPLETED', paymentMethod: 'CASH', isPaid: false },
      select: { id: true },
    });
    if (unconfirmedCash) {
      throw new ForbiddenError(
        `Anda masih punya pembayaran CASH order #${unconfirmedCash.id} yang belum dikonfirmasi diterima. Konfirmasi dulu sebelum bisa menerima order baru.`
      );
    }

    const orderToClaim = await prisma.order.findUnique({ where: { id: orderId }, select: { serviceType: true } });
    if (!orderToClaim) {
      throw new NotFoundError('Order tidak ditemukan!');
    }
    if (orderToClaim.serviceType !== 'SEND' && orderToClaim.serviceType !== (driverProfile as any).serviceType) {
      throw new ForbiddenError(
        `Order ini untuk layanan ${orderToClaim.serviceType}, sedangkan akun Anda terdaftar sebagai driver ${(driverProfile as any).serviceType}.`
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
      });
      SocketService.emitToDriversPool('order_taken', { orderId });
      SocketService.emitToAdmins('order_accepted', { orderId });
    } catch {
      // Socket.IO belum siap — abaikan.
    }

    return updatedOrder;
  }

  // ============================================================
  // 🔥 UPDATE STATUS - DENGAN RELEASE HOLD
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

    // ============================================================
    // 🔒 🔥 RELEASE HOLD jika order dibatalkan
    // ============================================================
    if (status === 'CANCELLED') {
      try {
        // Hanya jalankan jika model Transaction memiliki field status
        // await prisma.transaction.updateMany({
        //   where: {
        //     orderId: orderId,
        //     type: 'HOLD',
        //     status: 'PENDING',
        //   },
        //   data: {
        //     status: 'CANCELLED',
        //     description: `HOLD dibatalkan untuk order #${orderId}`,
        //   },
        // });
        logger.info(`[ORDER] HOLD released untuk order #${orderId} (CANCELLED)`);
      } catch (releaseError) {
        logger.error(`[ORDER] Gagal release HOLD untuk order #${orderId}:`, releaseError);
      }
    }

    // ============================================================
    // 🔒 🔥 COMMIT HOLD jika order COMPLETED (WALLET)
    // ============================================================
    if (status === 'COMPLETED' && (updatedOrder as any).paymentMethod === 'WALLET') {
      try {
        // Hanya jalankan jika model Transaction memiliki field status
        // await prisma.transaction.updateMany({
        //   where: {
        //     orderId: orderId,
        //     type: 'HOLD',
        //     status: 'PENDING',
        //   },
        //   data: {
        //     status: 'COMMITTED',
        //     description: `Pembayaran order #${orderId}`,
        //   },
        // });
        logger.info(`[ORDER] HOLD committed untuk order #${orderId} (COMPLETED - WALLET)`);
      } catch (commitError) {
        logger.error(`[ORDER] Gagal commit HOLD untuk order #${orderId}:`, commitError);
      }

      // Proses charge order (jika belum terbayar)
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