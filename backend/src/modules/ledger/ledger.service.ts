// modules/ledger/ledger.service.ts
import { Prisma } from '@prisma/client';
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
  // 🆕 FIX KONSEPTUAL "Ledger tidak boleh menjadi mesin kedua yang
  // memindahkan saldo": lihat komentar lengkap di recordOrderLedger().
  // Kalau true, entry ini HANYA ditulis sebagai catatan (baris
  // Ledger), TIDAK memanggil updateWallet() sama sekali -- dipakai
  // untuk order yang uangnya SUDAH dipindahkan tuntas oleh
  // PaymentService.chargeOrder() (WALLET), supaya Ledger murni jadi
  // JEJAK AUDIT dari apa yang sudah terjadi, bukan APLIKATOR kedua
  // yang menggerakkan saldo lagi.
  recordOnly?: boolean;
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
  // 🆕 FIX KONSEPTUAL KRITIS "Ledger tidak boleh menjadi mesin kedua
  // yang memindahkan saldo" (audit lanjutan):
  //
  // SEBELUMNYA method ini SELALU menggerakkan wallet (lewat
  // createLedgerEntry -> updateWallet -> applyDelta) untuk SEMUA order
  // COMPLETED non-CASH -- TERMASUK order WALLET. Padahal untuk order
  // WALLET, PaymentService.chargeOrder() SUDAH LEBIH DULU melakukan
  // SELURUH pemindahan uang secara atomik & lengkap (debit customer,
  // kredit driver, kredit merchant, dengan commission rate yang
  // dikunci dari PricingHistory yang sama) SEBELUM recordOrderLedger()
  // ini dipanggil dari order.service.ts. Akibatnya driver & merchant
  // DIKREDIT DUA KALI untuk SETIAP order WALLET -- sekali oleh
  // chargeOrder() (benar), sekali lagi oleh Ledger (redundan, pakai
  // perhitungan independen yang bisa saja beda angka).
  //
  // Ini PERSIS bug konseptual yang sama dengan "Cash accounting" yang
  // sudah diperbaiki sebelumnya (CASH dikecualikan dari blok generic
  // ini) -- tapi WALLET belum ikut dikecualikan karena chargeOrder()
  // tidak diperiksa cukup teliti saat itu. Root cause-nya sama: Ledger
  // seharusnya TIDAK PERNAH jadi "mesin kedua" yang mengambil keputusan
  // sendiri untuk memindahkan uang -- hanya PaymentService/WalletRepository
  // (lewat applyDelta) yang boleh benar-benar mengubah balance.
  //
  // FIX: parameter `recordOnly` baru. Kalau true, method ini (dan
  // createLedgerEntry di bawahnya) HANYA menulis baris Ledger sebagai
  // JEJAK AUDIT dari uang yang SUDAH dipindahkan pihak lain --
  // updateWallet() SAMA SEKALI TIDAK dipanggil. Dipakai order.service.ts
  // untuk order WALLET (chargeOrder sudah memindahkan uangnya).
  // Untuk QRIS/TRANSFER/EWALLET (belum ada engine pembayaran khusus
  // seperti chargeOrder), recordOnly TETAP false -- Ledger di sini
  // MASIH jadi satu-satunya jalur yang memindahkan uang, sampai ada
  // PaymentService setara untuk metode-metode itu (perbaikan lanjutan
  // di luar scope sesi ini).
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
  async recordOrderLedger(breakdown: OrderFeeBreakdown, options?: { recordOnly?: boolean }): Promise<void> {
    const recordOnly = options?.recordOnly ?? false;
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
      recordOnly,
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
        recordOnly,
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
        recordOnly,
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
        recordOnly,
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
        recordOnly,
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
        recordOnly,
        metadata: {
          rate: breakdown.breakdown.commissionRate || 0,
        },
      });
    }

    // ============================================================
    // 🆕 FIX P0 "Ledger settlement harus atomic sebagai batch" (audit):
    // SEBELUMNYA setiap entry di atas ditulis lewat panggilan
    // createLedgerEntry() TERPISAH, dan createLedgerEntry() membungkus
    // dirinya sendiri dalam prisma.$transaction() SENDIRI-SENDIRI --
    // artinya satu settlement order (bisa sampai 6 entry: customer
    // payment, driver earning, merchant earning, platform fee,
    // merchant fee, driver commission) sebenarnya adalah 6 TRANSAKSI
    // DATABASE TERPISAH, bukan satu. Kalau entry ke-3 gagal (mis. DB
    // hiccup sesaat, connection pool exhausted, constraint lain yang
    // tidak terduga), entry 1-2 SUDAH TERLANJUR COMMIT permanen dan
    // entry 4-6 TIDAK PERNAH ditulis -- settlement order itu jadi
    // SETENGAH JADI SELAMANYA (mis. customer sudah "dicatat membayar"
    // tapi driver tidak pernah dikreditkan), dan tidak ada mekanisme
    // otomatis untuk mendeteksi/memperbaikinya. Ini persis skenario
    // yang diperingatkan audit P0 #7: satu settlement finansial harus
    // all-or-nothing.
    //
    // FIX: seluruh batch sekarang ditulis dalam SATU prisma.$transaction
    // -- writeLedgerEntryInTx() melakukan langkah yang sama persis
    // dengan createLedgerEntry() (dedupe check, update wallet kalau
    // berlaku, insert baris Ledger) tapi memakai `tx` yang di-share,
    // BUKAN membuka transaksi baru per entry. Kalau entry manapun
    // gagal, SELURUH batch (termasuk entry yang sudah "berhasil"
    // sebelumnya di loop yang sama) di-rollback bersamaan -- tidak ada
    // lagi settlement setengah jadi.
    // ============================================================
    try {
      await prisma.$transaction(async (tx) => {
        for (const entry of entries) {
          await this.writeLedgerEntryInTx(tx, entry);
        }
      });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        // Seluruh batch ini sudah pernah ditulis sebelumnya (retry/replay
        // dari luar) -- reference @unique bentrok di salah satu entry.
        // Bukan error nyata, tapi tidak ada yang perlu ditulis ulang.
        logger.warn(`[LEDGER] Batch untuk order ${breakdown.orderId} sudah pernah dicatat sebelumnya -- dilewati (idempotent).`);
        return;
      }
      throw err;
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
    // Dipakai untuk penulisan SATU entry ledger yang berdiri sendiri
    // (di luar batch settlement order) -- membungkus writeLedgerEntryInTx
    // dalam transaksi barunya sendiri. Untuk batch settlement order,
    // lihat recordOrderLedger() yang memakai writeLedgerEntryInTx()
    // langsung di dalam SATU transaksi bersama demi atomicity batch
    // (P0 #7 -- lihat komentar lengkap di recordOrderLedger()).
    try {
      await prisma.$transaction(async (tx) => {
        await this.writeLedgerEntryInTx(tx, entry);
      });
    } catch (err: any) {
      // Race: dua request nyaris bersamaan lolos dedupe check di atas
      // tapi tabrakan di @unique constraint reference -- P2002. Ini
      // sama-sama berarti "sudah pernah dicatat", bukan error nyata.
      if (err?.code === 'P2002') {
        logger.warn(`[LEDGER] Duplicate entry (race condition) skipped: ${entry.reference}`);
        return;
      }
      throw err;
    }
  }

  // ============================================================
  // 🔒 WRITE SINGLE LEDGER ENTRY WITHIN A SHARED TRANSACTION
  //
  // Logika inti (dedupe check, update wallet kalau berlaku, insert
  // baris Ledger) diekstrak ke sini SUPAYA bisa dipanggil berkali-kali
  // di dalam SATU transaksi Prisma yang sama -- baik dari
  // createLedgerEntry() (transaksi baru per panggilan, untuk entry
  // tunggal) maupun dari recordOrderLedger() (satu transaksi untuk
  // SELURUH batch entry per order, demi atomicity -- P0 #7).
  // `tx` WAJIB berupa Prisma transaction client yang sedang aktif,
  // bukan `prisma` top-level -- method ini TIDAK membuka transaksi
  // sendiri.
  // ============================================================
  private async writeLedgerEntryInTx(tx: Prisma.TransactionClient, entry: LedgerEntry): Promise<void> {
    // Cek apakah ledger sudah ada (skip jika duplicate) -- reference
    // sudah @unique di skema, tapi dicek dulu supaya tidak throw P2002
    // dan log-nya lebih jelas ("duplicate skipped" vs error generik).
    const existing = await tx.ledger.findUnique({
      where: { reference: entry.reference },
    });

    if (existing) {
      logger.warn(`[LEDGER] Duplicate entry skipped: ${entry.reference}`);
      return;
    }

    let balanceAfter: number | null = null;

    // 🆕 FIX KONSEPTUAL "Ledger tidak boleh menjadi mesin kedua
    // yang memindahkan saldo": kalau entry.recordOnly=true, wallet
    // TIDAK disentuh sama sekali -- uangnya sudah dipindahkan
    // pihak lain (PaymentService.chargeOrder), entry ini murni
    // jejak audit (balanceAfter tetap null, karena entry ini
    // bukan penyebab perubahan saldo).
    if (entry.userId !== 'platform' && !entry.recordOnly) {
      let wallet = await tx.wallet.findUnique({ where: { userId: entry.userId } });
      if (!wallet) {
        wallet = await tx.wallet.create({ data: { userId: entry.userId, balance: 0 } });
      }

      const { wallet: updatedWallet } = await this.walletRepo.applyDelta(
        tx,
        wallet.id,
        entry.amount,
        this.mapLedgerTypeToTransactionType(entry.type),
        entry.description,
        entry.orderId,
        entry.reference
      );
      balanceAfter = Number(updatedWallet.balance);
    }

    await tx.ledger.create({
      data: {
        orderId: entry.orderId || null,
        userId: entry.userId,
        type: entry.type,
        amount: entry.amount,
        description: entry.description,
        reference: entry.reference,
        metadata: entry.metadata || {},
        balanceAfter,
      },
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