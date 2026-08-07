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

/**
 * 🆕 Pembagian pembayaran KHUSUS order MART (checkout dari Merchant).
 * SEBELUMNYA order MART memakai calculatePaymentSplit() yang sama dengan
 * order BIKE/CAR/SEND — akibatnya driver menerima HAMPIR SELURUH nilai
 * order (harga barang + ongkir) sebagai "pendapatan driver", dan MERCHANT
 * TIDAK PERNAH menerima apa pun untuk barang yang terjual. Fungsi ini
 * memisahkan order MART menjadi tiga bagian:
 *   - merchantEarning : nilai barang (itemsSubtotal) dikurangi platform fee
 *                        merchant -> masuk ke wallet pemilik toko.
 *   - driverEarning    : ongkir (deliveryFee) dikurangi komisi platform
 *                        (tarif tiered TariffEngine yang sama dengan order
 *                        lain, tapi dihitung dari ongkir saja, bukan dari
 *                        total order).
 *   - Sisanya (merchantFee + driverCommission) adalah pendapatan platform,
 *     sama seperti platformFee pada order biasa (tidak dikreditkan ke
 *     wallet mana pun secara eksplisit -- konsisten dengan pola yang sudah
 *     ada untuk platformFee non-MART).
 */
export function calculateMartPaymentSplit(
  price: Prisma.Decimal.Value,
  discount: Prisma.Decimal.Value,
  itemsSubtotal: Prisma.Decimal.Value,
  driverCommissionRate: number,
  merchantFeeRate: number
) {
  const amountToCharge = new Prisma.Decimal(price).minus(discount);
  const itemsSubtotalDecimal = new Prisma.Decimal(itemsSubtotal);
  // Ongkir = total ditagih - nilai barang (diskon, kalau ada, dianggap memotong ongkir dulu).
  const deliveryFee = amountToCharge.minus(itemsSubtotalDecimal);

  const merchantFee = itemsSubtotalDecimal.times(merchantFeeRate);
  const merchantEarning = itemsSubtotalDecimal.minus(merchantFee);

  const driverCommission = deliveryFee.times(driverCommissionRate);
  const driverEarning = deliveryFee.minus(driverCommission);

  const platformFee = merchantFee.plus(driverCommission);

  return {
    amountToCharge,
    itemsSubtotal: itemsSubtotalDecimal,
    deliveryFee,
    merchantFeeRate,
    merchantFee,
    merchantEarning,
    driverCommissionRate,
    driverCommission,
    driverEarning,
    platformFee,
  };
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

  /**
   * 🆕 Menyiapkan pembagian 3-arah (merchant/driver/platform) untuk order MART.
   * Memakai rate yang SUDAH DIKUNCI di PricingHistory saat checkout kalau ada
   * (lihat OrderService.createMerchantOrder), supaya tidak berubah retroaktif
   * kalau Admin mengubah rate platform fee merchant / tier komisi driver
   * setelah order dibuat. Order MART lama yang belum sempat punya
   * PricingHistory (mis. dibuat sebelum fitur ini ada) jatuh ke rate yang
   * berlaku SEKARANG sebagai fallback, supaya tetap bisa dibayar.
   */
  private async resolveMartSplit(order: {
    id: string;
    price: any;
    discount: any;
    orderItems?: { subtotal: any }[];
  }) {
    const pricingHistory = await this.paymentRepo.findPricingHistoryByOrderId(order.id);
    const breakdown = pricingHistory?.breakdown as any;

    const itemsSubtotal =
      breakdown && typeof breakdown.itemsSubtotal === 'number'
        ? breakdown.itemsSubtotal
        : (order.orderItems || []).reduce((sum, item) => sum + Number(item.subtotal), 0);

    const deliveryFeeRaw = new Prisma.Decimal(order.price).minus(order.discount).minus(itemsSubtotal).toNumber();

    const driverCommissionRate =
      breakdown && typeof breakdown.commissionRate === 'number'
        ? breakdown.commissionRate
        : (await this.tariffEngine.resolveCommissionRate(deliveryFeeRaw)).rate;

    const merchantFeeRate =
      breakdown && typeof breakdown.merchantFeeRate === 'number'
        ? breakdown.merchantFeeRate
        : await this.tariffEngine.getMerchantPlatformFeeRate();

    return calculateMartPaymentSplit(order.price, order.discount, itemsSubtotal, driverCommissionRate, merchantFeeRate);
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

    const isMartOrder = !!order.merchantId;

    // 🆕 Order MART (checkout dari Merchant) dipecah 3-arah: merchant dapat
    // nilai barang (dikurangi platform fee merchant), driver dapat komisi dari
    // ongkir saja -- SEBELUMNYA driver menerima hampir seluruh nilai order
    // (barang + ongkir) dan merchant tidak pernah dibayar sama sekali.
    const martSplit = isMartOrder ? await this.resolveMartSplit(order) : null;

    // Pakai commissionRate yang SUDAH DIKUNCI saat order dibuat (tersimpan di PricingHistory),
    // supaya tidak berubah retroaktif walau Admin mengubah tier komisi di kemudian hari.
    // Order lama yang belum punya PricingHistory (mis. data seed) jatuh ke tarif tiered
    // yang berlaku sekarang berdasarkan nilai order-nya.
    const commissionRate = isMartOrder
      ? martSplit!.driverCommissionRate
      : await this.resolveCommissionRateForOrder(order);

    const { amountToCharge, platformFee, driverEarning } = isMartOrder
      ? martSplit!
      : calculatePaymentSplit(order.price, order.discount, commissionRate);

    const customerWallet = await this.walletRepo.findOrCreateByUserId(customerUserId);
    const driverWallet = await this.walletRepo.findOrCreateByUserId(order.driver.userId);
    // Merchant hanya bisa dikreditkan kalau punya akun login (ownerId) —
    // sama seperti syarat notifikasi 'merchant_new_order' saat order dibuat.
    // Kalau tidak ada, bagian merchant TIDAK hilang -- tetap tercatat sebagai
    // bagian dari platformFee (lihat komentar di calculateMartPaymentSplit).
    const merchantOwnerId = isMartOrder ? (order as any).merchant?.ownerId : null;
    const merchantWallet = merchantOwnerId ? await this.walletRepo.findOrCreateByUserId(merchantOwnerId) : null;

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

        // Kreditkan pendapatan ke driver. Untuk order MART, ini HANYA komisi
        // dari ongkir (bukan nilai barang) -- lihat calculateMartPaymentSplit.
        const credit = await this.walletRepo.applyDelta(
          tx,
          driverWallet.id,
          driverEarning,
          'EARNING',
          isMartOrder
            ? `Ongkir order #${order.id} (setelah komisi platform ${(commissionRate * 100).toFixed(1)}%)`
            : `Pendapatan order #${order.id} (setelah komisi platform ${(commissionRate * 100).toFixed(1)}%)`,
          order.id,
          `${idempotencyKey}:credit`
        );

        // 🆕 Kreditkan pendapatan ke MERCHANT (nilai barang dikurangi platform
        // fee merchant) -- ini yang sebelumnya sama sekali tidak ada.
        let merchantCredit: Awaited<ReturnType<WalletRepository['applyDelta']>> | null = null;
        if (isMartOrder && martSplit && merchantWallet) {
          merchantCredit = await this.walletRepo.applyDelta(
            tx,
            merchantWallet.id,
            martSplit.merchantEarning,
            'MERCHANT_EARNING',
            `Penjualan order #${order.id} (setelah platform fee merchant ${(martSplit.merchantFeeRate * 100).toFixed(1)}%)`,
            order.id,
            `${idempotencyKey}:merchant-credit`
          );
        }

        const updatedOrder = await tx.order.update({
          where: { id: order.id },
          data: { isPaid: true },
        });

        return { debit, credit, merchantCredit, updatedOrder };
      });

      // Realtime: dashboard driver, merchant & customer langsung update tanpa refresh.
      try {
        SocketService.emitToOrder(order.id, 'order_paid', { orderId: order.id });
        SocketService.emitToUser(order.driver.userId, 'payment_received', {
          orderId: order.id,
          amount: driverEarning,
        });
        if (merchantOwnerId) {
          SocketService.emitToUser(merchantOwnerId, 'payment_received', {
            orderId: order.id,
            amount: martSplit?.merchantEarning,
          });
        }
        SocketService.emitToUser(customerUserId, 'payment_confirmed', { orderId: order.id });
        SocketService.emitToAdmins('order_paid', { orderId: order.id });
      } catch {
        // Socket.IO belum siap — abaikan, pembayaran tetap sukses tercatat.
      }

      return {
        order: result.updatedOrder,
        customerTransaction: result.debit.transaction,
        driverTransaction: result.credit.transaction,
        merchantTransaction: result.merchantCredit?.transaction ?? null,
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

    const isMartOrder = !!order.merchantId;
    const martSplit = isMartOrder ? await this.resolveMartSplit(order) : null;
    const commissionRate = isMartOrder ? martSplit!.driverCommissionRate : await this.resolveCommissionRateForOrder(order);
    const { platformFee } = isMartOrder
      ? martSplit!
      : calculatePaymentSplit(order.price, order.discount, commissionRate);

    // 🆕 Untuk order MART cash: customer membayar TUNAI ke driver untuk
    // SELURUH nilai order (barang + ongkir) -- driver memegang uang milik
    // merchant di tangannya. Selain komisi platform, saldo deposit driver
    // JUGA harus menutup bagian merchant (martSplit.merchantEarning) supaya
    // bisa langsung dikreditkan ke wallet merchant. Kalau tidak dipotong di
    // sini, merchant tidak akan pernah dibayar untuk transaksi cash.
    // Total yang dipotong dari deposit driver = platformFee + merchantEarning
    // (driver tetap menyimpan driverEarning-nya sebagai bagian dari cash yang
    // sudah di tangan, tidak perlu disetor).
    const depositDeduction = isMartOrder && martSplit ? platformFee.plus(martSplit.merchantEarning) : platformFee;

    const driverWallet = await this.walletRepo.findOrCreateByUserId(driverUserId);
    const merchantOwnerId = isMartOrder ? (order as any).merchant?.ownerId : null;
    const merchantWallet = merchantOwnerId ? await this.walletRepo.findOrCreateByUserId(merchantOwnerId) : null;
    const idempotencyKey = `cash-${order.id}`;
    const existing = await this.walletRepo.findTransactionByIdempotencyKey(idempotencyKey);
    if (existing) {
      return { order, alreadyProcessed: true };
    }

    try {
      const result = await prisma.$transaction(async (tx) => {
        // Potong komisi platform (+ bagian merchant kalau MART) dari deposit driver
        // (akan melempar error kalau saldo tidak cukup -- driver perlu top up dulu).
        const feeDeduction = await this.walletRepo.applyDelta(
          tx,
          driverWallet.id,
          depositDeduction.negated(),
          'PLATFORM_FEE',
          isMartOrder
            ? `Komisi platform + setoran hasil penjualan merchant order #${order.id} (dibayar tunai/cash, dipotong dari deposit)`
            : `Komisi platform order #${order.id} (dibayar tunai/cash oleh customer, dipotong dari deposit)`,
          order.id,
          idempotencyKey
        );

        // 🆕 Setorkan bagian merchant yang baru dipotong dari deposit driver ke wallet merchant.
        let merchantCredit: Awaited<ReturnType<WalletRepository['applyDelta']>> | null = null;
        if (isMartOrder && martSplit && merchantWallet) {
          merchantCredit = await this.walletRepo.applyDelta(
            tx,
            merchantWallet.id,
            martSplit.merchantEarning,
            'MERCHANT_EARNING',
            `Penjualan order #${order.id} (dibayar tunai/cash, disetor dari deposit driver, setelah platform fee merchant ${(martSplit.merchantFeeRate * 100).toFixed(1)}%)`,
            order.id,
            `${idempotencyKey}:merchant-credit`
          );
        }

        const updatedOrder = await tx.order.update({ where: { id: order.id }, data: { isPaid: true } });
        return { feeDeduction, merchantCredit, updatedOrder };
      });

      // Realtime: dashboard customer, driver & merchant langsung sinkron.
      try {
        SocketService.emitToOrder(order.id, 'order_paid', { orderId: order.id });
        SocketService.emitToUser(driverUserId, 'payment_received', { orderId: order.id });
        if (merchantOwnerId) {
          SocketService.emitToUser(merchantOwnerId, 'payment_received', {
            orderId: order.id,
            amount: martSplit?.merchantEarning,
          });
        }
        if (order.customer?.userId) {
          SocketService.emitToUser(order.customer.userId, 'payment_confirmed', { orderId: order.id });
        }
        SocketService.emitToAdmins('order_paid', { orderId: order.id });
      } catch {
        // Socket.IO belum siap — abaikan.
      }

      return {
        order: result.updatedOrder,
        transaction: result.feeDeduction.transaction,
        merchantTransaction: result.merchantCredit?.transaction ?? null,
        alreadyProcessed: false,
      };
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

    const isMartOrder = !!order.merchantId;
    // 🆕 QRIS/Transfer/E-Wallet manual: dana sudah dianggap diterima PLATFORM
    // (bukan driver) di luar sistem, jadi tidak perlu potong siapa pun — cukup
    // kreditkan bagian masing-masing pihak (driver dari ongkir, merchant dari
    // nilai barang) langsung dari "kas" platform, persis seperti order biasa
    // yang langsung mengkreditkan driverEarning tanpa proses debit.
    const martSplit = isMartOrder ? await this.resolveMartSplit(order) : null;
    const commissionRate = isMartOrder ? martSplit!.driverCommissionRate : await this.resolveCommissionRateForOrder(order);
    const driverEarning = isMartOrder ? martSplit!.driverEarning : calculatePaymentSplit(order.price, order.discount, commissionRate).driverEarning;

    const driverWallet = await this.walletRepo.findOrCreateByUserId(driverProfile.userId);
    const merchantOwnerId = isMartOrder ? (order as any).merchant?.ownerId : null;
    const merchantWallet = merchantOwnerId ? await this.walletRepo.findOrCreateByUserId(merchantOwnerId) : null;
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
          isMartOrder
            ? `Ongkir order #${order.id} (dibayar via ${proof.method}, disetujui admin, setelah komisi ${(commissionRate * 100).toFixed(1)}%)`
            : `Pendapatan order #${order.id} (dibayar via ${proof.method}, disetujui admin, setelah komisi ${(commissionRate * 100).toFixed(1)}%)`,
          order.id,
          idempotencyKey
        );

        // 🆕 Kreditkan bagian merchant juga (sebelumnya tidak pernah ada).
        let merchantCredit: Awaited<ReturnType<WalletRepository['applyDelta']>> | null = null;
        if (isMartOrder && martSplit && merchantWallet) {
          merchantCredit = await this.walletRepo.applyDelta(
            tx,
            merchantWallet.id,
            martSplit.merchantEarning,
            'MERCHANT_EARNING',
            `Penjualan order #${order.id} (dibayar via ${proof.method}, disetujui admin, setelah platform fee merchant ${(martSplit.merchantFeeRate * 100).toFixed(1)}%)`,
            order.id,
            `${idempotencyKey}:merchant-credit`
          );
        }

        await tx.order.update({ where: { id: order.id }, data: { isPaid: true } });
        const updatedProof = await tx.paymentProof.update({
          where: { id: proofId },
          data: { status: 'APPROVED', reviewedBy: adminUserId, reviewedAt: new Date(), reviewNote },
        });
        return { credit, merchantCredit, updatedProof };
      });
    } catch (err: any) {
      // Race kondisi: dua admin (atau double-click) menyetujui bukti yang sama nyaris bersamaan.
      if (err.code === 'P2002') {
        const refreshedProof = await this.paymentRepo.findPaymentProofById(proofId);
        return { proof: refreshedProof, order: proof.order, alreadyProcessed: true } as any;
      }
      throw err;
    }

    // Realtime: driver, merchant & customer langsung tahu bukti bayar disetujui, tanpa refresh.
    try {
      SocketService.emitToOrder(order.id, 'order_paid', { orderId: order.id });
      SocketService.emitToUser(driverProfile.userId, 'payment_received', { orderId: order.id });
      if (merchantOwnerId) {
        SocketService.emitToUser(merchantOwnerId, 'payment_received', { orderId: order.id, amount: martSplit?.merchantEarning });
      }
      if ((order as any).customer?.userId) {
        SocketService.emitToUser((order as any).customer.userId, 'payment_confirmed', { orderId: order.id });
      }
      SocketService.emitToAdmins('order_paid', { orderId: order.id });
    } catch {
      // Socket.IO belum siap — abaikan.
    }

    return {
      proof: result.updatedProof,
      transaction: result.credit.transaction,
      merchantTransaction: result.merchantCredit?.transaction ?? null,
      order,
      alreadyProcessed: false,
    } as any;
  }
}
