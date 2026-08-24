import { prisma } from '../../config/prisma';
import { AppError } from '../../core/errors/AppError';
import { logger } from '../../config/logger';
import { AuditLogger } from '../../core/logging/audit.logger';
import { SocketService } from '../../websocket/socket';
import { WalletRepository } from './wallet.repository';

export class WalletAdminService {
  private walletRepo = new WalletRepository();

  async listWithdrawals() {
    return prisma.withdrawalRequest.findMany({
      where: { status: { in: ['PENDING_REVIEW', 'PENDING_TRANSFER', 'APPROVED', 'PROCESSING'] } },
      include: { user: { select: { id: true, fullName: true, email: true, role: true } } },
      orderBy: { createdAt: 'asc' }, take: 100,
    });
  }

  async reviewWithdrawal(adminId: string, requestId: string, action: string, reviewNote?: string) {
    const request = await prisma.withdrawalRequest.findUnique({ where: { id: requestId } });
    if (!request) throw new AppError('Permintaan pencairan tidak ditemukan.', 404);
    if (request.payoutProvider && request.payoutProvider !== 'MANUAL') {
      throw new AppError('Pencairan otomatis hanya boleh diselesaikan oleh status resmi provider/webhook.', 409);
    }
    const now = new Date();
    const transitions: Record<string, { from: string[]; to: string }> = {
      APPROVE: { from: ['PENDING_REVIEW'], to: 'APPROVED' },
      PROCESS: { from: ['APPROVED'], to: 'PROCESSING' },
      COMPLETE: { from: ['APPROVED', 'PROCESSING'], to: 'COMPLETED' },
      REJECT: { from: ['PENDING_REVIEW'], to: 'REJECTED' },
      FAIL: { from: ['APPROVED', 'PROCESSING'], to: 'FAILED' },
      COMPLETE_MANUAL: { from: ['PENDING_TRANSFER'], to: 'COMPLETED' },
      REFUND_MANUAL: { from: ['PENDING_TRANSFER'], to: 'FAILED' },
    };
    const transition = transitions[action];
    if (!transition || !transition.from.includes(request.status)) throw new AppError(`Aksi ${action} tidak valid untuk status ${request.status}.`, 409);

    if (action === 'COMPLETE_MANUAL' && (!reviewNote || reviewNote.trim().length < 3)) {
      throw new AppError('Nomor referensi transfer wajib diisi.', 400);
    }
    const updated = await prisma.$transaction(async (tx) => {
      const { count } = await tx.withdrawalRequest.updateMany({
        where: { id: requestId, status: { in: transition.from as any } },
        data: {
          status: transition.to as any,
          reviewedBy: adminId,
          reviewNote: reviewNote?.trim() || null,
          reviewedAt: ['APPROVE', 'REJECT', 'COMPLETE_MANUAL', 'REFUND_MANUAL'].includes(action) ? now : request.reviewedAt,
          processedAt: action === 'PROCESS' ? now : request.processedAt,
          completedAt: ['COMPLETE', 'COMPLETE_MANUAL'].includes(action) ? now : null,
          manualTransferReference: action === 'COMPLETE_MANUAL' ? reviewNote!.trim() : request.manualTransferReference,
          manualTransferredAt: action === 'COMPLETE_MANUAL' ? now : request.manualTransferredAt,
          providerStatus: action === 'COMPLETE_MANUAL' ? 'MANUALLY_TRANSFERRED' : action === 'REFUND_MANUAL' ? 'MANUAL_TRANSFER_CANCELLED' : request.providerStatus,
        },
      });
      if (count !== 1) throw new AppError('Permintaan sudah diproses oleh Admin lain.', 409);
      if (action === 'REJECT' || action === 'FAIL' || action === 'REFUND_MANUAL') {
        let wallet = await tx.wallet.findUnique({ where: { userId: request.userId } });
        if (!wallet) wallet = await tx.wallet.create({ data: { userId: request.userId, balance: 0, earningsBalance: 0 } });
        await this.walletRepo.applyDelta(tx, wallet.id, Number(request.amount), 'WITHDRAWAL_REFUND', `Pengembalian dana pencairan ${requestId}`, undefined, `withdrawal-refund-${requestId}`);
      }
      if (action === 'COMPLETE' || action === 'COMPLETE_MANUAL') {
        let wallet = await tx.wallet.findUnique({ where: { userId: request.userId } });
        if (!wallet) wallet = await tx.wallet.create({ data: { userId: request.userId, balance: 0, earningsBalance: 0 } });
        await tx.transaction.create({
          data: {
            walletId: wallet.id,
            type: 'WITHDRAWAL_COMPLETED',
            amount: 0,
            description: `Pencairan selesai ${requestId}${reviewNote?.trim() ? ` · Ref: ${reviewNote.trim()}` : ''}`,
            idempotencyKey: `withdrawal-completed-${requestId}`,
          },
        });
      }
      return tx.withdrawalRequest.findUniqueOrThrow({ where: { id: requestId } });
    });
    await AuditLogger.log(adminId, `WITHDRAWAL_${action}`, `${requestId} user ${request.userId} Rp${request.amount}`);
    SocketService.emitToUser(request.userId, 'withdrawal_status_changed', { requestId, status: updated.status, amount: request.amount });
    return updated;
  }

  // ============================================================
  // 🔒 LIST PENDING REQUESTS
  // ============================================================
  async listPendingRequests() {
    return prisma.topupRequest.findMany({
      where: { status: 'PENDING_REVIEW' },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            fullName: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  // ============================================================
  // 🔒 APPROVE TOPUP
  // ============================================================
  async approveTopup(
    adminId: string,
    requestId: string,
    reviewNote?: string
  ) {
    const request = await prisma.topupRequest.findUnique({
      where: { id: requestId },
      include: { user: true },
    });

    if (!request) {
      throw new AppError('Topup request not found', 404);
    }

    if (request.status !== 'PENDING_REVIEW') {
      throw new AppError(`Request already ${request.status}`, 400);
    }

    if (!request.user.isActive) {
      throw new AppError('User account is inactive', 400);
    }

    const requestAge = Date.now() - new Date(request.createdAt).getTime();
    if (requestAge > 24 * 60 * 60 * 1000) {
      await prisma.topupRequest.update({
        where: { id: requestId },
        data: {
          status: 'REJECTED',
          reviewNote: 'Request expired (24 hours)',
          reviewedBy: adminId,
          reviewedAt: new Date(),
        },
      });
      throw new AppError('Request expired (24 hours)', 400);
    }

    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.topupRequest.update({
        where: { id: requestId },
        data: {
          status: 'APPROVED',
          reviewNote: reviewNote || 'Approved by admin',
          reviewedBy: adminId,
          reviewedAt: new Date(),
        },
      });

      let wallet = await tx.wallet.findUnique({
        where: { userId: request.userId },
      });

      if (!wallet) {
        wallet = await tx.wallet.create({
          data: {
            userId: request.userId,
            balance: 0,
          },
        });
      }

      // 🆕 FIX "Wallet architecture": disatukan ke WalletRepository.applyDelta()
      // (satu-satunya jalur mutasi wallet yang punya guard anti-saldo-negatif
      // & representasi Transaction.amount bertanda konsisten) -- sebelumnya
      // di sini pakai tx.wallet.update({increment}) manual + tx.transaction.create()
      // terpisah, jalur berbeda dari applyDelta() yang dipakai payment.service.ts.
      const { wallet: updatedWallet } = await this.walletRepo.applyDelta(
        tx,
        wallet.id,
        Number(request.amount),
        'TOPUP',
        `Topup via ${request.method} - approved by admin`,
        undefined,
        `topup-${requestId}`
      );

      return { updated, updatedWallet };
    });

    await AuditLogger.log(
      adminId,
      'TOPUP_APPROVED',
      `Approved topup Rp${request.amount} for user ${request.userId} (request: ${requestId})`
    );

    try {
      SocketService.emitToUser(request.userId, 'topup_approved', {
        requestId,
        amount: request.amount,
        newBalance: result.updatedWallet.balance,
      });
    } catch {
      // Socket belum siap
    }

    logger.info(`[TOPUP] Approved: ${requestId} - User ${request.userId} - Rp${request.amount}`);

    return result.updated;
  }

  // ============================================================
  // 🔒 REJECT TOPUP
  // ============================================================
  async rejectTopup(
    adminId: string,
    requestId: string,
    reason: string
  ) {
    const request = await prisma.topupRequest.findUnique({
      where: { id: requestId },
    });

    if (!request) {
      throw new AppError('Topup request not found', 404);
    }

    if (request.status !== 'PENDING_REVIEW') {
      throw new AppError(`Request already ${request.status}`, 400);
    }

    const updated = await prisma.topupRequest.update({
      where: { id: requestId },
      data: {
        status: 'REJECTED',
        reviewNote: reason,
        reviewedBy: adminId,
        reviewedAt: new Date(),
      },
    });

    await AuditLogger.log(
      adminId,
      'TOPUP_REJECTED',
      `Rejected topup Rp${request.amount} for user ${request.userId} - Reason: ${reason}`
    );

    try {
      SocketService.emitToUser(request.userId, 'topup_rejected', {
        requestId,
        reason,
      });
    } catch {
      // Socket belum siap
    }

    logger.info(`[TOPUP] Rejected: ${requestId} - User ${request.userId} - Reason: ${reason}`);

    return updated;
  }

  // ============================================================
  // 🔒 CREDIT USER WALLET (SATU-SATUNYA JALUR SAH ADMIN MENAMBAH
  // SALDO USER LAIN SECARA LANGSUNG, DI LUAR ANTREAN TopupRequest)
  //
  // Menggantikan bypass lama 'role===ADMIN' di POST /api/wallet/topup
  // yang mengkredit wallet PEMANGGIL SENDIRI tanpa target eksplisit,
  // tanpa alasan, tanpa batas nominal, dan tanpa jejak audit yang jelas.
  //
  // Aturan wajib di sini:
  // - targetUserId WAJIB diisi (divalidasi UUID di schema)
  // - TIDAK BOLEH menyasar diri sendiri (admin tidak bisa credit ke akunnya sendiri)
  // - dibatasi Rp50.000.000 per transaksi (sudah divalidasi di adminWalletCreditSchema,
  //   dicek ulang di sini sebagai defense-in-depth)
  // - reason wajib diisi (untuk audit)
  // - full audit log via AuditLogger + notifikasi socket ke target user
  // ============================================================
  async creditUserWallet(
    adminId: string,
    targetUserId: string,
    amount: number,
    reason: string,
    idempotencyKey?: string
  ) {
    if (targetUserId === adminId) {
      throw new AppError(
        'Admin tidak boleh mengkredit saldo ke akunnya sendiri. Gunakan flow topup-request biasa jika perlu menambah saldo akun Anda sendiri.',
        403
      );
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      throw new AppError('Nominal harus lebih dari 0!', 400);
    }

    const MAX_CREDIT_PER_TX = 50_000_000;
    if (amount > MAX_CREDIT_PER_TX) {
      throw new AppError(
        `Nominal maksimal Rp${MAX_CREDIT_PER_TX.toLocaleString('id-ID')} per transaksi!`,
        400
      );
    }

    if (!reason || reason.trim().length < 5) {
      throw new AppError('Alasan wajib diisi, minimal 5 karakter (untuk audit)!', 400);
    }

    const targetUser = await prisma.user.findUnique({ where: { id: targetUserId } });
    if (!targetUser) {
      throw new AppError('User target tidak ditemukan!', 404);
    }
    if (!targetUser.isActive) {
      throw new AppError('User target tidak aktif!', 400);
    }

    // 🆕 FIX P0 IDEMPOTENCY KRITIS (audit): versi sebelumnya, kalau client
    // tidak mengirim idempotencyKey, server diam-diam generate key ACAK
    // (`crypto.randomUUID()`) SEKALI per panggilan sebagai fallback. Key
    // acak itu TIDAK PERNAH sama antar dua request -- jadi @unique
    // constraint di Transaction tidak pernah kena collision, dan
    // double-klik tombol atau retry jaringan dari dashboard admin bisa
    // MENGKREDIT DUA KALI tanpa terdeteksi sama sekali. Fallback itu
    // memberi ILUSI aman (kodenya "punya idempotency key") padahal untuk
    // request yang paling butuh perlindungan (client yang belum kirim
    // key) perlindungannya nol.
    //
    // Sekarang idempotencyKey WAJIB dari client (ditegakkan di
    // adminWalletCreditSchema, .optional() sudah dihapus) -- tidak ada
    // fallback server-side sama sekali. Kalau sampai lolos ke sini tanpa
    // key (mis. dipanggil langsung dari kode lain, bukan lewat route),
    // request DITOLAK eksplisit daripada diam-diam "diamankan sendiri".
    if (!idempotencyKey) {
      throw new AppError(
        'idempotencyKey wajib diisi untuk kredit wallet admin -- operasi finansial ini harus bisa diretry dengan aman tanpa risiko double-credit.',
        400
      );
    }
    const key = idempotencyKey;

    const existing = await prisma.transaction.findUnique({
      where: { idempotencyKey: key },
      include: { wallet: true },
    });
    if (existing) {
      logger.info(`[WALLET] Idempotent replay terdeteksi untuk key ${key} -- mengembalikan hasil transaksi asli, TIDAK mengkredit ulang.`);
      return { updatedWallet: existing.wallet, transaction: existing, replayed: true };
    }

    let result;
    try {
      result = await prisma.$transaction(async (tx) => {
        let wallet = await tx.wallet.findUnique({ where: { userId: targetUserId } });

        if (!wallet) {
          wallet = await tx.wallet.create({
            data: { userId: targetUserId, balance: 0 },
          });
        }

        // 🆕 FIX "Wallet architecture": disatukan ke applyDelta() (lihat
        // catatan yang sama di approveTopupRequest di atas).
        const { wallet: updatedWallet, transaction } = await this.walletRepo.applyDelta(
          tx,
          wallet.id,
          amount,
          'ADMIN_CREDIT',
          `Kredit manual oleh Admin: ${reason}`,
          undefined,
          key
        );

        return { updatedWallet, transaction };
      });
    } catch (err: any) {
      // Race: dua request dengan idempotencyKey sama nyaris bersamaan
      // lolos pengecekan findUnique di atas tapi tabrakan di unique
      // constraint DB -- P2002 dari Prisma. Ambil transaksi yang
      // BERHASIL masuk duluan, jangan anggap ini error ke client.
      if (err?.code === 'P2002' && idempotencyKey) {
        const existing = await prisma.transaction.findUnique({
          where: { idempotencyKey: key },
          include: { wallet: true },
        });
        if (existing) {
          logger.warn(`[WALLET] Race condition idempotency key ${key} -- mengembalikan transaksi yang menang race.`);
          return { updatedWallet: existing.wallet, transaction: existing, replayed: true };
        }
      }
      throw err;
    }

    await AuditLogger.log(
      adminId,
      'ADMIN_WALLET_CREDIT',
      `Admin ${adminId} mengkredit Rp${amount.toLocaleString('id-ID')} ke user ${targetUserId}. Alasan: ${reason}`
    );

    try {
      SocketService.emitToUser(targetUserId, 'wallet_credited_by_admin', {
        amount,
        reason,
        newBalance: result.updatedWallet.balance,
      });
    } catch {
      // Socket belum siap
    }

    logger.info(
      `[WALLET] Admin ${adminId} credited Rp${amount} to user ${targetUserId}. Reason: ${reason}`
    );

    return result;
  }
}
