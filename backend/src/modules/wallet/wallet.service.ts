import { WalletRepository } from './wallet.repository';
import { AppError, NotFoundError } from '../../core/errors/AppError';
import { prisma } from '../../config/prisma';
import { logger } from '../../config/logger';
import { SocketService } from '../../websocket/socket';

export class WalletService {
  private walletRepo = new WalletRepository();

  // ============================================================
  // 🔒 KONSTANTA VALIDASI
  // ============================================================
  private readonly DAILY_LIMIT = 1000000; // 1Juta/hari
  private readonly TX_LIMIT = 500000; // 500K/transaksi
  private readonly MAX_PENDING_REQUESTS = 3; // Max 3 pending request
  private readonly MIN_TOPUP = 5000; // Min 5K

  // ============================================================
  // 🔒 GET BALANCE
  // ============================================================
  async getBalance(userId: string) {
    const wallet = await this.walletRepo.findOrCreateByUserId(userId);
    return wallet;
  }

  // ============================================================
  // 🔒 GET TRANSACTION HISTORY
  // ============================================================
  async getTransactionHistory(userId: string, limit = 50, offset = 0) {
    const wallet = await this.walletRepo.findOrCreateByUserId(userId);
    const transactions = await this.walletRepo.listTransactions(wallet.id, limit, offset);
    return { wallet, transactions };
  }

  // ============================================================
  // 🔒 VALIDASI TOPUP REQUEST
  // ============================================================
  async validateTopupRequest(userId: string, amount: number): Promise<{
    valid: boolean;
    error?: string;
  }> {
    // 1. Validasi amount minimum
    if (amount < this.MIN_TOPUP) {
      return {
        valid: false,
        error: `Minimal top-up adalah Rp${this.MIN_TOPUP.toLocaleString('id-ID')}`,
      };
    }

    // 2. Validasi amount maksimum per transaksi
    if (amount > this.TX_LIMIT) {
      return {
        valid: false,
        error: `Maksimal top-up per transaksi adalah Rp${this.TX_LIMIT.toLocaleString('id-ID')}`,
      };
    }

    // 3. Cek daily limit (dari transaction yang sudah COMPLETED hari ini)
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const dailyTotal = await prisma.transaction.aggregate({
      where: {
        wallet: { userId },
        type: 'TOPUP',
        createdAt: { gte: today },
      },
      _sum: { amount: true },
    });

    const totalToday = Number(dailyTotal._sum.amount || 0);
    if (totalToday + amount > this.DAILY_LIMIT) {
      return {
        valid: false,
        error: `Daily limit exceeded. Remaining: Rp${(this.DAILY_LIMIT - totalToday).toLocaleString('id-ID')}`,
      };
    }

    // 4. Cek pending requests (cegah spam)
    const pendingCount = await prisma.topupRequest.count({
      where: {
        userId,
        status: 'PENDING_REVIEW',
      },
    });

    if (pendingCount >= this.MAX_PENDING_REQUESTS) {
      return {
        valid: false,
        error: `You have ${pendingCount} pending requests. Please wait for review.`,
      };
    }

    return { valid: true };
  }

// ============================================================
// 🔒 LEGACY TOPUP - HANYA UNTUK INTERNAL/ADMIN
// ============================================================
async topup(userId: string, amount: number, callerRole?: string) {
  // 🔒 GUARD: HANYA ADMIN YANG BOLEH PANGGIL INI LANGSUNG
  if (callerRole !== 'ADMIN') {
    throw new AppError(
      'Direct topup is not allowed. Please use topup request flow.',
      403
    );
  }

  if (amount < this.MIN_TOPUP) {
    throw new AppError(`Minimal top-up adalah Rp${this.MIN_TOPUP.toLocaleString('id-ID')}`, 400);
  }

  const wallet = await this.walletRepo.findOrCreateByUserId(userId);

  const result = await this.walletRepo.runInTransaction(async (tx) => {
    return this.walletRepo.applyDelta(
      tx,
      wallet.id,
      amount,
      'TOPUP',
      `Top-up saldo sebesar Rp${amount.toLocaleString('id-ID')} (Admin)`
    );
  });

  return result;
}

  // ============================================================
  // 🔒 REQUEST TOPUP (DENGAN VALIDASI + PENDING REVIEW)
  // ============================================================
  async requestTopup(
    userId: string,
    amount: number,
    method: string,
    proofImageUrl: string,
    note?: string
  ) {
    // 🔒 Validasi sebelum create request
    const validation = await this.validateTopupRequest(userId, amount);
    if (!validation.valid) {
      throw new AppError(validation.error!, 400);
    }

    // 🔒 Cek user aktif
    const user = await prisma.user.findUnique({
      where: { id: userId, isActive: true },
    });
    if (!user) {
      throw new AppError('User not found or inactive', 404);
    }

    // 🔒 Validasi metode pembayaran
    const validMethods = ['BANK_TRANSFER', 'QRIS', 'EWALLET', 'TRANSFER'];
    if (!validMethods.includes(method)) {
      throw new AppError('Invalid payment method', 400);
    }

    // 🔒 Validasi bukti upload
    if (!proofImageUrl || proofImageUrl.length < 10) {
      throw new AppError('Valid proof image is required', 400);
    }

    // 🔒 Cek apakah ada request yang sama (duplikat)
    const existingDuplicate = await prisma.topupRequest.findFirst({
      where: {
        userId,
        amount,
        status: 'PENDING_REVIEW',
        proofImageUrl,
        createdAt: { gte: new Date(Date.now() - 5 * 60 * 1000) }, // 5 menit terakhir
      },
    });

    if (existingDuplicate) {
      throw new AppError('Duplicate request detected. Please wait for review.', 409);
    }

    // Create topup request
    const topupRequest = await prisma.topupRequest.create({
      data: {
        userId,
        amount,
        method: method as any,
        proofImageUrl,
        note,
        status: 'PENDING_REVIEW',
        createdAt: new Date(),
      },
    });

    // 🔒 Log untuk audit
    logger.info(`[TOPUP] Request created: ${topupRequest.id} - User ${userId} - Rp${amount}`);

    // 🔒 Notifikasi ke Admin
    try {
      SocketService.emitToAdmins('topup_request_created', {
        requestId: topupRequest.id,
        userId,
        amount,
        method,
      });
    } catch {
      // Socket belum siap
    }

    return topupRequest;
  }

  // ============================================================
  // 🔒 GET TOPUP HISTORY
  // ============================================================
  async getTopupHistory(userId: string, limit = 20, offset = 0) {
    const requests = await prisma.topupRequest.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });

    const total = await prisma.topupRequest.count({
      where: { userId },
    });

    return {
      data: requests,
      pagination: {
        total,
        limit,
        offset,
      },
    };
  }
}