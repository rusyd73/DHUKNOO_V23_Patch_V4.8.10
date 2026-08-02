import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { PaymentRepository } from './payment.repository';
import { WalletRepository } from '../wallet/wallet.repository';
import { TariffEngineService } from '../tariff/tariff.service';
import { AppError, NotFoundError, ForbiddenError } from '../../core/errors/AppError';
import { SocketService } from '../../websocket/socket';

/**
 * Menghitung pembagian pembayaran satu order: berapa yang ditagih ke customer
 * (harga - diskon), berapa komisi platform (tarif TIERED dari Tariff Engine,
 * bukan lagi flat), dan berapa yang diterima driver.
 * Dipisah sebagai fungsi murni (tidak menyentuh DB) supaya mudah diuji unit test.
 */
export function calculatePaymentSplit(
  price: Prisma.Decimal.Value,
  discount: Prisma.Decimal.Value,
  commissionRate: number
) {
  const amountToCharge = new Prisma.Decimal(price).minus(discount);
  const platformFee = amountToCharge.times(commissionRate);
  const driverEarning = amountToCharge.minus(platformFee);
  return { amountToCharge, platformFee, driverEarning };
}

export class PaymentService {
  private paymentRepo = new PaymentRepository();
  private walletRepo = new WalletRepository();
  private tariffEngine = new TariffEngineService();

  private async resolveCommissionRateForOrder(order: { id: string; price: any; discount: any }) {
    const pricingHistory = await this.paymentRepo.findPricingHistoryByOrderId(order.id);
    const amountToChargeRaw = new Prisma.Decimal(order.price).minus(order.discount).toNumber();
    return pricingHistory?.breakdown && typeof (pricingHistory.breakdown as any).commissionRate === 'number'
      ? (pricingHistory.breakdown as any).commissionRate
      : (await this.tariffEngine.resolveCommissionRate(amountToChargeRaw)).rate;
  }

  async chargeOrder(customerUserId: string, orderId: string, idempotencyKey: string) {
    // 1. Idempotency guard — jika key ini sudah pernah diproses, kembalikan hasil yang sama
    //    tanpa memotong saldo dua kali (mis. akibat client retry karena timeout jaringan).
    const debitKey = `${idempotencyKey}:debit`;
    const existing = await this.walletRepo.findTransactionByIdempotencyKey(debitKey);
    if (existing) {
      const order = await this.paymentRepo.findOrderById(orderId);
      return { order, alreadyProcessed: true };
    }

    const order = await this.paymentRepo.findOrderById(orderId);
    if (!order) {
      throw new NotFoundError('Order tidak ditemukan!');
    }
    if (order.customer.userId !== customerUserId) {
      throw new ForbiddenError('Order ini bukan milik Anda!');
    }
    if (order.isPaid) {
      throw new AppError('Order ini sudah dibayar sebelumnya!', 409);
    }
    if (order.status !== 'COMPLETED') {
      throw new AppError('Order hanya bisa dibayar setelah perjalanan berstatus COMPLETED!', 400);
    }
    if (!order.driverId || !order.driver) {
      throw new AppError('Order belum memiliki driver yang ditugaskan!', 400);
    }

    // Pakai commissionRate yang SUDAH DIKUNCI saat order dibuat (tersimpan di PricingHistory),
    // supaya tidak berubah retroaktif walau Admin mengubah tier komisi di kemudian hari.
    // Order lama yang belum punya PricingHistory (mis. data seed) jatuh ke tarif tiered
    // yang berlaku sekarang berdasarkan nilai order-nya.
    const pricingHistory = await this.paymentRepo.findPricingHistoryByOrderId(orderId);
    const amountToChargeRaw = new Prisma.Decimal(order.price).minus(order.discount).toNumber();
    const commissionRate =
      pricingHistory?.breakdown && typeof (pricingHistory.breakdown as any).commissionRate === 'number'
        ? (pricingHistory.breakdown as any).commissionRate
        : (await this.tariffEngine.resolveCommissionRate(amountToChargeRaw)).rate;

    const { amountToCharge, platformFee, driverEarning } = calculatePaymentSplit(
      order.price,
      order.discount,
      commissionRate
    );

    const customerWallet = await this.walletRepo.findOrCreateByUserId(customerUserId);
    const driverWallet = await this.walletRepo.findOrCreateByUserId(order.driver.userId);

    try {
      const result = await prisma.$transaction(async (tx) => {
        // Potong saldo customer (akan otomatis melempar error jika saldo tidak cukup)
        const debit = await this.walletRepo.applyDelta(
          tx,
          customerWallet.id,
          amountToCharge.negated(),
          'PAYMENT',
          `Pembayaran order #${order.id}`,
          order.id,
          debitKey
        );

        // Kreditkan pendapatan ke driver (harga - komisi platform)
        const credit = await this.walletRepo.applyDelta(
          tx,
          driverWallet.id,
          driverEarning,
          'EARNING',
          `Pendapatan order #${order.id} (setelah komisi platform ${(commissionRate * 100).toFixed(1)}%)`,
          order.id,
          `${idempotencyKey}:credit`
        );

        const updatedOrder = await tx.order.update({
          where: { id: order.id },
          data: { isPaid: true },
        });

        return { debit, credit, updatedOrder };
      });

      // Realtime: dashboard driver & customer langsung update tanpa refresh.
      try {
        SocketService.emitToOrder(order.id, 'order_paid', { orderId: order.id });
        SocketService.emitToUser(order.driver.userId, 'payment_received', {
          orderId: order.id,
          amount: driverEarning,
        });
        SocketService.emitToUser(customerUserId, 'payment_confirmed', { orderId: order.id });
        SocketService.emitToAdmins('order_paid', { orderId: order.id });
      } catch {
        // Socket.IO belum siap — abaikan, pembayaran tetap sukses tercatat.
      }

      return {
        order: result.updatedOrder,
        customerTransaction: result.debit.transaction,
        driverTransaction: result.credit.transaction,
        platformFee,
        alreadyProcessed: false,
      };
    } catch (err: any) {
      // Race kondisi: dua request dengan idempotencyKey sama nyaris bersamaan
      if (err.code === 'P2002') {
        const refreshedOrder = await this.paymentRepo.findOrderById(orderId);
        return { order: refreshedOrder, alreadyProcessed: true };
      }
      throw err;
    }
  }

  listPendingProofs() {
    return this.paymentRepo.listPendingPaymentProofs();
  }

  /**
   * Konfirmasi pembayaran CASH — driver menerima uang tunai langsung dari customer
   * (di luar sistem wallet). Platform tetap harus dapat komisinya: dipotong
   * langsung dari SALDO DEPOSIT driver (bukan dari customer, karena customer
   * sudah bayar cash di tangan). Kalau saldo deposit driver tidak cukup untuk
   * menutup komisi, konfirmasi ditolak — driver perlu top up dulu.
   */
  async confirmCash(driverUserId: string, orderId: string) {
    const order = await this.paymentRepo.findOrderById(orderId);
    if (!order) throw new NotFoundError('Order tidak ditemukan!');
    if (!order.driver || order.driver.userId !== driverUserId) {
      throw new ForbiddenError('Order ini bukan tugas Anda!');
    }
    if (order.isPaid) {
      throw new AppError('Order ini sudah ditandai lunas sebelumnya!', 409);
    }
    if (order.status !== 'COMPLETED') {
      throw new AppError('Order hanya bisa dikonfirmasi lunas setelah berstatus COMPLETED!', 400);
    }
    if (order.paymentMethod !== 'CASH') {
      throw new AppError('Order ini tidak memakai metode pembayaran CASH!', 400);
    }

    const commissionRate = await this.resolveCommissionRateForOrder(order);
    const { platformFee } = calculatePaymentSplit(order.price, order.discount, commissionRate);

    const driverWallet = await this.walletRepo.findOrCreateByUserId(driverUserId);
    const idempotencyKey = `cash-${order.id}`;
    const existing = await this.walletRepo.findTransactionByIdempotencyKey(idempotencyKey);
    if (existing) {
      return { order, alreadyProcessed: true };
    }

    try {
      const result = await prisma.$transaction(async (tx) => {
        // Potong komisi platform dari deposit driver (akan melempar error kalau saldo tidak cukup)
        const feeDeduction = await this.walletRepo.applyDelta(
          tx,
          driverWallet.id,
          platformFee.negated(),
          'PLATFORM_FEE',
          `Komisi platform order #${order.id} (dibayar tunai/cash oleh customer, dipotong dari deposit)`,
          order.id,
          idempotencyKey
        );
        const updatedOrder = await tx.order.update({ where: { id: order.id }, data: { isPaid: true } });
        return { feeDeduction, updatedOrder };
      });

      // Realtime: dashboard customer & driver langsung sinkron.
      try {
        SocketService.emitToOrder(order.id, 'order_paid', { orderId: order.id });
        SocketService.emitToUser(driverUserId, 'payment_received', { orderId: order.id });
        if (order.customer?.userId) {
          SocketService.emitToUser(order.customer.userId, 'payment_confirmed', { orderId: order.id });
        }
        SocketService.emitToAdmins('order_paid', { orderId: order.id });
      } catch {
        // Socket.IO belum siap — abaikan.
      }

      return { order: result.updatedOrder, transaction: result.feeDeduction.transaction, alreadyProcessed: false };
    } catch (err: any) {
      // Race kondisi: dua konfirmasi cash nyaris bersamaan dengan idempotencyKey sama.
      if (err.code === 'P2002') {
        const refreshedOrder = await this.paymentRepo.findOrderById(orderId);
        return { order: refreshedOrder, alreadyProcessed: true };
      }
      throw err;
    }
  }

  /**
   * Customer meng-upload bukti bayar manual (QRIS/Transfer/E-Wallet) — belum
   * memindahkan uang apa pun, hanya mencatat pengajuan untuk ditinjau Admin.
   * Ini dipakai SEMENTARA sebelum ada integrasi payment gateway otomatis
   * (Xendit/Midtrans) yang butuh akun & API key milik platform sendiri.
   */
  async submitPaymentProof(
    customerUserId: string,
    orderId: string,
    method: 'QRIS' | 'TRANSFER' | 'EWALLET',
    proofImageUrl: string,
    note?: string
  ) {
    const order = await this.paymentRepo.findOrderById(orderId);
    if (!order) throw new NotFoundError('Order tidak ditemukan!');
    if (order.customer.userId !== customerUserId) {
      throw new ForbiddenError('Order ini bukan milik Anda!');
    }
    if (order.isPaid) {
      throw new AppError('Order ini sudah lunas!', 409);
    }
    if (order.status !== 'COMPLETED') {
      throw new AppError('Bukti bayar hanya bisa diupload setelah order berstatus COMPLETED!', 400);
    }

    const existing = await this.paymentRepo.findPaymentProofByOrderId(orderId);
    if (existing && existing.status !== 'REJECTED') {
      throw new AppError('Bukti bayar untuk order ini sudah pernah diupload dan sedang/sudah ditinjau!', 409);
    }

    return this.paymentRepo.createOrReplacePaymentProof(orderId, method, proofImageUrl, note);
  }

  /** Admin meninjau bukti bayar manual. Kalau APPROVED, kreditkan pendapatan ke driver. */
  async reviewPaymentProof(adminUserId: string, proofId: string, status: 'APPROVED' | 'REJECTED', reviewNote?: string) {
    const proof = await this.paymentRepo.findPaymentProofById(proofId);
    if (!proof) throw new NotFoundError('Bukti bayar tidak ditemukan!');
    if (proof.status !== 'PENDING_REVIEW') {
      throw new AppError('Bukti bayar ini sudah pernah ditinjau!', 409);
    }

    if (status === 'REJECTED') {
      const updated = await this.paymentRepo.updatePaymentProofStatus(proofId, 'REJECTED', adminUserId, reviewNote);
      return { proof: updated, order: proof.order };
    }

    // APPROVED — kreditkan pendapatan ke driver (platform dianggap sudah menerima
    // dana dari customer lewat kanal QRIS/Transfer/E-Wallet manual di luar sistem).
    const order = proof.order;
    if (!order.driverId) {
      throw new AppError('Order ini belum memiliki driver, tidak bisa dikreditkan!', 400);
    }
    const driverProfile = await prisma.driverProfile.findUnique({ where: { id: order.driverId } });
    if (!driverProfile) throw new NotFoundError('Profil driver tidak ditemukan!');

    const commissionRate = await this.resolveCommissionRateForOrder(order);
    const { driverEarning } = calculatePaymentSplit(order.price, order.discount, commissionRate);
    const driverWallet = await this.walletRepo.findOrCreateByUserId(driverProfile.userId);
    const idempotencyKey = `proof-${proofId}`;
    const existingTx = await this.walletRepo.findTransactionByIdempotencyKey(idempotencyKey);
    if (existingTx) {
      const updated = await this.paymentRepo.findPaymentProofById(proofId);
      return { proof: updated, order: proof.order, alreadyProcessed: true } as any;
    }

    let result;
    try {
      result = await prisma.$transaction(async (tx) => {
        const credit = await this.walletRepo.applyDelta(
          tx,
          driverWallet.id,
          driverEarning,
          'EARNING',
          `Pendapatan order #${order.id} (dibayar via ${proof.method}, disetujui admin, setelah komisi ${(commissionRate * 100).toFixed(1)}%)`,
          order.id,
          idempotencyKey
        );
        await tx.order.update({ where: { id: order.id }, data: { isPaid: true } });
        const updatedProof = await tx.paymentProof.update({
          where: { id: proofId },
          data: { status: 'APPROVED', reviewedBy: adminUserId, reviewedAt: new Date(), reviewNote },
        });
        return { credit, updatedProof };
      });
    } catch (err: any) {
      // Race kondisi: dua admin (atau double-click) menyetujui bukti yang sama nyaris bersamaan.
      if (err.code === 'P2002') {
        const refreshedProof = await this.paymentRepo.findPaymentProofById(proofId);
        return { proof: refreshedProof, order: proof.order, alreadyProcessed: true } as any;
      }
      throw err;
    }

    // Realtime: driver & customer langsung tahu bukti bayar disetujui, tanpa refresh.
    try {
      SocketService.emitToOrder(order.id, 'order_paid', { orderId: order.id });
      SocketService.emitToUser(driverProfile.userId, 'payment_received', { orderId: order.id });
      if ((order as any).customer?.userId) {
        SocketService.emitToUser((order as any).customer.userId, 'payment_confirmed', { orderId: order.id });
      }
      SocketService.emitToAdmins('order_paid', { orderId: order.id });
    } catch {
      // Socket.IO belum siap — abaikan.
    }

    return { proof: result.updatedProof, transaction: result.credit.transaction, order, alreadyProcessed: false } as any;
  }
}
