// modules/ledger/ledger.service.ts
import { prisma } from '../../config/prisma';
import { logger } from '../../config/logger';
import { WalletRepository } from '../wallet/wallet.repository';

export interface LedgerEntry {
  orderId?: string;
  userId: string;
  type: string;
  amount: number;
  description: string;
  reference: string;
  metadata?: any;
}

export interface OrderFeeBreakdown {
  orderId: string;
  customerPayment: number;
  driverEarning: number;
  merchantEarning: number;
  platformFee: number;
  merchantFee: number;
  driverCommission: number;
  breakdown: {
    itemsSubtotal?: number;
    deliveryFee?: number;
    shippingFee?: number;
    discount?: number;
    merchantFeeRate?: number;
    commissionRate?: number;
  };
}

export class LedgerService {
  private walletRepo = new WalletRepository();

  // ============================================================
  // 🔒 RECORD ORDER LEDGER
  //
  // 🆕 FIX BUG KRITIS (double-deduction): breakdown.driverEarning &
  // breakdown.merchantEarning sekarang GROSS (lihat komentar di
  // OrderService.calculateOrderBreakdown). Entri DRIVER_EARNING /
  // MERCHANT_EARNING di bawah menulis jumlah GROSS itu, dan entri
  // DRIVER_COMMISSION / MERCHANT_FEE memotongnya SATU KALI lewat entri
  // negatif terpisah -- net yang benar-benar masuk ke wallet driver/
  // merchant adalah GROSS dikurangi entri commission/fee tsb, dijumlah
  // oleh sistem wallet (updateWallet increment per entri), BUKAN
  // dipotong dua kali seperti versi sebelumnya.
  //
  // Total uang harus reconcile:
  //   customerPayment = (deliveryFee - driverCommission)
  //                    + (itemsSubtotal - merchantFee)
  //                    + (merchantFee + driverCommission)   [=platformFee]
  // ============================================================
  async recordOrderLedger(breakdown: OrderFeeBreakdown): Promise<void> {
    const order = await prisma.order.findUnique({
      where: { id: breakdown.orderId },
      include: {
        customer: { include: { user: true } },
        driver: { include: { user: true } },
        merchant: true,
      },
    });

    if (!order) {
      throw new Error(`Order ${breakdown.orderId} not found`);
    }

    const entries: LedgerEntry[] = [];

    // 1. CUSTOMER PAYMENT (negative)
    entries.push({
      orderId: breakdown.orderId,
      userId: order.customer.userId,
      type: 'CUSTOMER_PAYMENT',
      amount: -breakdown.customerPayment,
      description: `Pembayaran order #${breakdown.orderId}`,
      reference: `order-${breakdown.orderId}-customer`,
      metadata: {
        paymentMethod: order.paymentMethod,
      },
    });

    // 2. DRIVER EARNING (positive, GROSS -- dipotong DRIVER_COMMISSION di bawah)
    if (order.driverId && order.driver && breakdown.driverEarning > 0) {
      entries.push({
        orderId: breakdown.orderId,
        userId: order.driver.userId,
        type: 'DRIVER_EARNING',
        amount: breakdown.driverEarning,
        description: `Pendapatan driver order #${breakdown.orderId} (kotor, sebelum komisi platform)`,
        reference: `order-${breakdown.orderId}-driver`,
        metadata: {
          shippingFee: breakdown.breakdown.shippingFee,
          note: 'Jumlah ini GROSS -- lihat entri DRIVER_COMMISSION untuk potongan komisi platform.',
        },
      });
    }

    // 3. MERCHANT EARNING (positive, GROSS -- dipotong MERCHANT_FEE di bawah)
    if (order.merchantId && order.merchant && breakdown.merchantEarning > 0) {
      const merchantUserId = order.merchant.ownerId || 'system';
      entries.push({
        orderId: breakdown.orderId,
        userId: merchantUserId,
        type: 'MERCHANT_EARNING',
        amount: breakdown.merchantEarning,
        description: `Pendapatan merchant order #${breakdown.orderId} (kotor, sebelum fee platform)`,
        reference: `order-${breakdown.orderId}-merchant`,
        metadata: {
          itemsSubtotal: breakdown.breakdown.itemsSubtotal,
          note: 'Jumlah ini GROSS -- lihat entri MERCHANT_FEE untuk potongan fee platform.',
        },
      });
    }

    // 4. PLATFORM FEE (positive)
    if (breakdown.platformFee > 0) {
      entries.push({
        orderId: breakdown.orderId,
        userId: 'platform',
        type: 'PLATFORM_FEE',
        amount: breakdown.platformFee,
        description: `Platform fee order #${breakdown.orderId}`,
        reference: `order-${breakdown.orderId}-platform`,
        metadata: {
          merchantFee: breakdown.merchantFee,
          driverCommission: breakdown.driverCommission,
        },
      });
    }

    // 5. MERCHANT FEE (negative)
    if (order.merchantId && order.merchant && breakdown.merchantFee > 0) {
      const merchantUserId = order.merchant.ownerId || 'system';
      entries.push({
        orderId: breakdown.orderId,
        userId: merchantUserId,
        type: 'MERCHANT_FEE',
        amount: -breakdown.merchantFee,
        description: `Biaya platform merchant order #${breakdown.orderId}`,
        reference: `order-${breakdown.orderId}-merchant-fee`,
        metadata: {
          rate: breakdown.breakdown.merchantFeeRate || 0,
        },
      });
    }

    // 6. DRIVER COMMISSION (negative)
    if (order.driverId && order.driver && breakdown.driverCommission > 0) {
      entries.push({
        orderId: breakdown.orderId,
        userId: order.driver.userId,
        type: 'DRIVER_COMMISSION',
        amount: -breakdown.driverCommission,
        description: `Komisi platform driver order #${breakdown.orderId}`,
        reference: `order-${breakdown.orderId}-driver-commission`,
        metadata: {
          rate: breakdown.breakdown.commissionRate || 0,
        },
      });
    }

    // Save all entries
    for (const entry of entries) {
      await this.createLedgerEntry(entry);
    }

    logger.info(`[LEDGER] Recorded ${entries.length} entries for order ${breakdown.orderId}`);
  }

  // ============================================================
  // 🔒 CREATE SINGLE LEDGER ENTRY
  //
  // 🆕 FIX KRITIS "Ledger SQL schema": versi sebelumnya pakai raw SQL
  // ($executeRaw) dengan NAMA KOLOM YANG SALAH TOTAL --
  // `order_id`/`user_id`/`created_at` (snake_case) padahal kolom
  // sungguhan di Postgres adalah `"orderId"`/`"userId"`/`"createdAt"`
  // (camelCase, lihat migration.sql CREATE TABLE "Ledger" ...), DAN
  // menyisipkan kolom `balance` yang SAMA SEKALI TIDAK ADA di skema
  // Ledger manapun. Akibatnya: SETIAP pemanggilan createLedgerEntry()
  // akan throw error Postgres ("column \"order_id\" of relation
  // \"Ledger\" does not exist") -- ARTINYA SELURUH MEKANISME
  // PENCATATAN LEDGER TIDAK PERNAH BERHASIL MENULIS SATU BARIS PUN,
  // sejak modul ini pertama dibuat. Perbaikan aritmetika double-
  // deduction sebelumnya benar secara matematis TAPI TIDAK PERNAH
  // benar-benar tersimpan ke database karena crash di sini duluan.
  //
  // Komentar asli bilang "raw SQL karena model Ledger mungkin belum
  // di-generate" -- tapi model Ledger SUDAH ADA lengkap di
  // schema.prisma (dengan @@index dst), jadi TIDAK PERLU raw SQL sama
  // sekali. Diganti total ke prisma.ledger.create() yang type-safe,
  // sekaligus menghilangkan seluruh kelas bug nama-kolom seperti ini.
  // ============================================================
  async createLedgerEntry(entry: LedgerEntry): Promise<void> {
    // Cek apakah ledger sudah ada (skip jika duplicate) -- reference
    // sudah @unique di skema, tapi dicek dulu supaya tidak throw P2002
    // dan log-nya lebih jelas ("duplicate skipped" vs error generik).
    const existing = await prisma.ledger.findUnique({
      where: { reference: entry.reference },
    });

    if (existing) {
      logger.warn(`[LEDGER] Duplicate entry skipped: ${entry.reference}`);
      return;
    }

    try {
      await prisma.ledger.create({
        data: {
          orderId: entry.orderId || null,
          userId: entry.userId,
          type: entry.type,
          amount: entry.amount,
          description: entry.description,
          reference: entry.reference,
          metadata: entry.metadata || {},
        },
      });
    } catch (err: any) {
      // Race: dua request nyaris bersamaan lolos findUnique di atas
      // tapi tabrakan di @unique constraint reference -- P2002. Ini
      // sama-sama berarti "sudah pernah dicatat", bukan error nyata.
      if (err?.code === 'P2002') {
        logger.warn(`[LEDGER] Duplicate entry (race condition) skipped: ${entry.reference}`);
        return;
      }
      throw err;
    }

    // Update wallet jika userId bukan 'platform'
    if (entry.userId !== 'platform') {
      await this.updateWallet(entry.userId, entry.amount, entry);
    }
  }

  // ============================================================
  // 🔒 UPDATE WALLET
  // ============================================================
  // ============================================================
  // 🔒 UPDATE WALLET
  //
  // 🆕 FIX "Wallet architecture": sebelumnya method ini menulis LANGSUNG
  // ke Prisma (`tx.wallet.update({data:{balance:{increment}}})`) tanpa
  // guard sama sekali -- BEDA jalur dari WalletRepository.applyDelta()
  // yang sudah dibuat khusus untuk mencegah saldo jadi negatif (lihat
  // AUDIT NOTE di wallet.repository.ts). Dua jalur mutasi wallet dengan
  // jaminan keamanan berbeda untuk resource yang sama = arsitektur yang
  // rapuh -- gampang lupa salah satu jalur pas ada perubahan aturan di
  // masa depan (persis seperti ini: rule "saldo tidak boleh negatif"
  // cuma berlaku di satu jalur, tidak di jalur lain yang JUSTRU dipakai
  // di SETIAP order selesai). Representasi juga tidak konsisten:
  // Transaction.amount dari sini SELALU positif (Math.abs), sementara
  // dari applyDelta() ikut tanda asli (bisa negatif) -- membingungkan
  // untuk apa pun yang menjumlah Transaction.amount mengasumsikan tanda
  // konsisten (mis. validateTopupRequest's dailyTotal aggregate).
  // Sekarang delegasikan total ke applyDelta() -- satu sumber
  // kebenaran untuk mutasi wallet, guard & representasi konsisten.
  // ============================================================
  private async updateWallet(userId: string, amount: number, entry: LedgerEntry): Promise<void> {
    await prisma.$transaction(async (tx) => {
      let wallet = await tx.wallet.findUnique({
        where: { userId },
      });

      if (!wallet) {
        wallet = await tx.wallet.create({
          data: {
            userId,
            balance: 0,
          },
        });
      }

      await this.walletRepo.applyDelta(
        tx,
        wallet.id,
        amount,
        this.mapLedgerTypeToTransactionType(entry.type),
        entry.description,
        entry.orderId,
        entry.reference
      );
    });
  }

  // ============================================================
  // 🔒 MAP LEDGER TYPE TO TRANSACTION TYPE
  // ============================================================
  private mapLedgerTypeToTransactionType(type: string): any {
    const mapping: Record<string, string> = {
      'CUSTOMER_PAYMENT': 'PAYMENT',
      'DRIVER_EARNING': 'EARNING',
      'MERCHANT_EARNING': 'MERCHANT_EARNING',
      'PLATFORM_FEE': 'PLATFORM_FEE',
      'MERCHANT_FEE': 'PLATFORM_FEE',
      'DRIVER_COMMISSION': 'PLATFORM_FEE',
      'REFUND': 'REFUND',
    };
    return mapping[type] || 'PAYMENT';
  }

  // ============================================================
  // 🔒 GET PLATFORM REVENUE SUMMARY
  //
  // 🆕 FIX "Ledger SQL schema": raw SQL sebelumnya juga pakai
  // order_id/created_at (snake_case, salah) -- diganti ke
  // prisma.ledger.groupBy() yang type-safe.
  // ============================================================
  async getPlatformRevenueSummary(
    startDate: Date,
    endDate: Date
  ): Promise<{
    totalPlatformFee: number;
    totalMerchantFee: number;
    totalDriverCommission: number;
    totalRevenue: number;
    byOrder: any[];
  }> {
    const fees = await prisma.ledger.groupBy({
      by: ['orderId', 'type'],
      where: {
        type: { in: ['PLATFORM_FEE', 'MERCHANT_FEE', 'DRIVER_COMMISSION'] },
        createdAt: { gte: startDate, lte: endDate },
      },
      _sum: { amount: true },
    });

    const normalized = fees.map(f => ({
      orderId: f.orderId,
      type: f.type,
      total: f._sum.amount ? Number(f._sum.amount) : 0,
    }));

    const platformFees = normalized.filter(f => f.type === 'PLATFORM_FEE');
    const merchantFees = normalized.filter(f => f.type === 'MERCHANT_FEE');
    const driverCommissions = normalized.filter(f => f.type === 'DRIVER_COMMISSION');

    return {
      totalPlatformFee: platformFees.reduce((sum, f) => sum + f.total, 0),
      totalMerchantFee: merchantFees.reduce((sum, f) => sum + Math.abs(f.total), 0),
      totalDriverCommission: driverCommissions.reduce((sum, f) => sum + Math.abs(f.total), 0),
      totalRevenue: platformFees.reduce((sum, f) => sum + f.total, 0),
      byOrder: normalized,
    };
  }

  // ============================================================
  // 🔒 RECONCILE ORDER
  //
  // 🆕 FIX: sebelumnya switch di bawah HANYA menjumlah
  // CUSTOMER_PAYMENT/DRIVER_EARNING/MERCHANT_EARNING/PLATFORM_FEE dan
  // MENGABAIKAN entri MERCHANT_FEE & DRIVER_COMMISSION sama sekali.
  // Karena DRIVER_EARNING/MERCHANT_EARNING sekarang GROSS (lihat
  // recordOrderLedger), reconcile HARUS ikut menjumlah kedua entri
  // negatif itu supaya totalCredit mencerminkan NET yang benar-benar
  // diterima driver/merchant -- kalau tidak, isBalanced bisa bernilai
  // true padahal ada bug double-deduction (atau kebalikannya).
  // ============================================================
  async reconcileOrder(orderId: string): Promise<{
    customerPayment: number;
    driverEarning: number;
    merchantEarning: number;
    merchantFee: number;
    driverCommission: number;
    platformFee: number;
    totalDebit: number;
    totalCredit: number;
    isBalanced: boolean;
  }> {
    // 🆕 FIX "Ledger SQL schema": raw SQL sebelumnya `WHERE order_id =
    // ...` (snake_case, kolom sungguhan bernama "orderId") -- selalu
    // throw "column order_id does not exist". Diganti ke findMany biasa.
    const entries = await prisma.ledger.findMany({ where: { orderId } });

    let customerPayment = 0;
    let driverEarning = 0;
    let merchantEarning = 0;
    let merchantFee = 0;
    let driverCommission = 0;
    let platformFee = 0;

    for (const entry of entries) {
      switch (entry.type) {
        case 'CUSTOMER_PAYMENT':
          customerPayment += Number(entry.amount);
          break;
        case 'DRIVER_EARNING':
          driverEarning += Number(entry.amount);
          break;
        case 'MERCHANT_EARNING':
          merchantEarning += Number(entry.amount);
          break;
        case 'MERCHANT_FEE':
          merchantFee += Number(entry.amount); // sudah negatif
          break;
        case 'DRIVER_COMMISSION':
          driverCommission += Number(entry.amount); // sudah negatif
          break;
        case 'PLATFORM_FEE':
          platformFee += Number(entry.amount);
          break;
      }
    }

    const totalDebit = customerPayment; // negatif
    // NET driver = driverEarning(gross) + driverCommission(negatif)
    // NET merchant = merchantEarning(gross) + merchantFee(negatif)
    const totalCredit =
      (driverEarning + driverCommission) +
      (merchantEarning + merchantFee) +
      platformFee;

    return {
      customerPayment,
      driverEarning,
      merchantEarning,
      merchantFee,
      driverCommission,
      platformFee,
      totalDebit,
      totalCredit,
      isBalanced: Math.abs(Math.abs(totalDebit) - totalCredit) < 0.01,
    };
  }
}