// modules/reconciliation/reconciliation.service.ts
//
// 🆕 FIX P1 "Tambahkan durable reconciliation/retry workflow untuk
// kondisi payment atau ledger gagal" (audit a1.4). SEBELUMNYA satu-
// satunya jejak kegagalan settlement adalah baris di ActivityLog (lewat
// AuditLogger) yang harus DICARI MANUAL oleh admin -- tidak ada cara
// sistematis untuk melihat daftar order mana saja yang masih menggantung,
// apalagi mencoba ulang settlement-nya lewat satu tombol. "Audit log saja
// tidak cukup untuk recovery otomatis" -- persis kalimat di audit.
//
// Modul ini menyediakan:
//   1. listPendingReconciliation() -- query eksplisit atas
//      Order.settlementStatus (state machine baru, lihat schema.prisma)
//      untuk order yang butuh perhatian: RETRY_REQUIRED atau FAILED.
//   2. retrySettlement() -- retry TERKENDALI (admin-triggered lewat
//      endpoint, BUKAN cron otomatis yang tidak bisa saya uji end-to-end
//      di lingkungan ini) yang memanggil ULANG PaymentService.chargeOrder()
//      dengan idempotency key YANG SAMA PERSIS dengan percobaan auto-debit
//      awal (`auto-wallet-${orderId}`) -- aman diretry berkali-kali karena
//      PaymentService.chargeOrder() sudah idempotent (lihat pengecekan
//      idempotencyKey di awal method itu).
//
// CATATAN JUJUR SOAL SCOPE: ini BUKAN worker/scheduler otomatis yang
// jalan sendiri di background (mis. cron job tiap 5 menit) -- itu butuh
// infrastruktur job queue (BullMQ dkk, yang di proyek ini statusnya
// sendiri belum stabil -- lihat P0 #9 soal Redis/Dispatch) dan tidak
// realistis untuk diklaim "sudah teruji" tanpa environment yang bisa
// menjalankannya sungguhan. Yang disediakan di sini adalah endpoint
// admin yang DURABLE dan RE-QUERYABLE (bukan cuma log) sebagai fondasi
// -- job scheduler otomatis di atasnya adalah langkah lanjutan yang
// wajar (tinggal panggil retrySettlement() dari cron/BullMQ repeatable
// job begitu infrastrukturnya siap).

import { prisma } from '../../config/prisma';
import { AppError, NotFoundError } from '../../core/errors/AppError';
import { AuditLogger } from '../../core/logging/audit.logger';
import { logger } from '../../config/logger';
import { PaymentService } from '../payment/payment.service';

export class ReconciliationService {
  private paymentService = new PaymentService();

  /**
   * Daftar order yang settlement-nya masih menggantung (RETRY_REQUIRED)
   * atau sudah gagal di-retry sebelumnya dan butuh investigasi manual
   * (FAILED). Diurutkan dari yang paling lama menggantung -- biasanya
   * paling mendesak untuk ditinjau.
   */
  async listPendingReconciliation() {
    return prisma.order.findMany({
      where: { settlementStatus: { in: ['RETRY_REQUIRED', 'FAILED'] } },
      include: {
        customer: { include: { user: { select: { fullName: true, email: true } } } },
        driver: { include: { user: { select: { fullName: true, email: true } } } },
      },
      orderBy: { updatedAt: 'asc' },
    });
  }

  /**
   * Retry settlement untuk SATU order, dipicu admin. Saat ini hanya
   * menangani order WALLET (auto-debit) -- inilah satu-satunya jalur
   * settlement yang bisa di-retry secara PROGRAMATIK dengan aman lewat
   * idempotency key yang sudah ada. Order CASH settlement-nya lewat
   * confirmCash() oleh DRIVER (memotong deposit driver sendiri -- tidak
   * pas dipicu admin atas nama driver), dan order QRIS/TRANSFER/EWALLET
   * settlement-nya lewat reviewPaymentProof() yang butuh bukti bayar
   * BARU dari customer (bukan sesuatu yang bisa "diretry" tanpa input
   * baru) -- untuk keduanya, method ini menolak dengan pesan yang
   * menjelaskan tindakan manual yang sebenarnya diperlukan, daripada
   * berpura-pura bisa memperbaikinya otomatis.
   */
  async retrySettlement(adminId: string, orderId: string) {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { customer: true },
    });
    if (!order) {
      throw new NotFoundError('Order tidak ditemukan!');
    }
    if (order.settlementStatus === 'SETTLED') {
      throw new AppError('Order ini sudah SETTLED -- tidak perlu diretry.', 409);
    }
    if (order.paymentMethod !== 'WALLET') {
      throw new AppError(
        order.paymentMethod === 'CASH'
          ? 'Order CASH tidak bisa diretry lewat reconciliation -- settlement CASH harus dikonfirmasi driver lewat POST /api/payment/confirm-cash (memotong deposit driver sendiri).'
          : 'Order dengan metode ini butuh bukti bayar BARU dari customer -- minta customer upload ulang lewat POST /api/payment/proof, lalu tinjau lewat POST /api/payment/proofs/:id/review.',
        400
      );
    }

    try {
      // Idempotency key SAMA PERSIS dengan percobaan auto-debit awal di
      // OrderService.updateStatus() -- kalau ternyata SUDAH pernah
      // berhasil (race dengan retry lain), chargeOrder() akan mendeteksi
      // ini lewat pengecekan idempotencyKey dan mengembalikan
      // alreadyProcessed:true tanpa memotong saldo dua kali.
      const result = await this.paymentService.chargeOrder(
        order.customer.userId,
        orderId,
        `auto-wallet-${orderId}`
      );

      await AuditLogger.log(
        adminId,
        'PAYMENT_SETTLEMENT_RETRIED',
        `Admin ${adminId} berhasil me-retry settlement order #${orderId}. alreadyProcessed=${result.alreadyProcessed}.`
      );

      return { order: result.order, alreadyProcessed: result.alreadyProcessed };
    } catch (err: any) {
      // Retry GAGAL lagi -- eskalasi ke FAILED (bukan RETRY_REQUIRED lagi)
      // supaya admin tahu ini butuh investigasi manual, bukan sekadar
      // diklik retry berulang-ulang tanpa hasil.
      logger.error(`[RECONCILIATION] Retry gagal untuk order ${orderId}: ${err?.message || err}`);
      try {
        await prisma.order.update({
          where: { id: orderId },
          data: { settlementStatus: 'FAILED' },
        });
        await AuditLogger.log(
          adminId,
          'PAYMENT_SETTLEMENT_RETRY_FAILED',
          `Admin ${adminId} mencoba retry settlement order #${orderId}, GAGAL LAGI: ${err?.message || err}. settlementStatus=FAILED, butuh investigasi manual (mis. cek saldo wallet customer).`
        );
      } catch (recordError) {
        logger.error(`[RECONCILIATION] Gagal mencatat FAILED untuk order ${orderId}:`, recordError);
      }
      throw err;
    }
  }
}
