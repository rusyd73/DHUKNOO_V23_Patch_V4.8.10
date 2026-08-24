import { WalletRepository } from './wallet.repository';
import { AppError, NotFoundError } from '../../core/errors/AppError';
import { prisma } from '../../config/prisma';
import { logger } from '../../config/logger';
import { SocketService } from '../../websocket/socket';
import { PayoutService } from './payout.service';

export class WalletService {
  private walletRepo = new WalletRepository();
  private payoutService = new PayoutService();

  // ============================================================
  // 🔒 KONSTANTA VALIDASI
  // ============================================================
  private readonly DAILY_LIMIT = 1000000; // 1Juta/hari
  private readonly TX_LIMIT = 500000; // 500K/transaksi
  private readonly MAX_PENDING_REQUESTS = 3; // Max 3 pending request
  private readonly MIN_TOPUP = 5000; // Min 5K
  private readonly MIN_WITHDRAWAL = 10000;
  private readonly MAX_WITHDRAWAL = 5000000;

  private async minimumRetainedBalance(role: string) {
    if (role !== 'DRIVER') return 0;
    const config = await prisma.platformConfig.findUnique({ where: { key: 'MINIMUM_DRIVER_DEPOSIT' } });
    const value = Number(config?.value || 0);
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  async getWithdrawalHistory(userId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (!user || !['DRIVER', 'MERCHANT'].includes(user.role)) throw new AppError('Pencairan hanya tersedia untuk Driver dan Merchant.', 403);
    const wallet = await this.walletRepo.findOrCreateByUserId(userId);
    const minimumRetained = await this.minimumRetainedBalance(user.role);
    const requests = await prisma.withdrawalRequest.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 20 });
    return {
      requests,
      walletBalance: wallet.balance,
      earningsBalance: wallet.earningsBalance,
      minimumRetained,
      availableAmount: Math.max(0, Math.min(Number(wallet.earningsBalance), Number(wallet.balance) - minimumRetained)),
    };
  }

  async requestWithdrawal(userId: string, input: { amount: number; method: string; destinationProvider: string; destinationAccount: string; destinationName: string; note?: string }) {
    const user = await prisma.user.findUnique({ where: { id: userId, isActive: true }, select: { role: true } });
    if (!user || !['DRIVER', 'MERCHANT'].includes(user.role)) throw new AppError('Pencairan hanya tersedia untuk Driver dan Merchant aktif.', 403);
    if (!Number.isFinite(input.amount) || input.amount < this.MIN_WITHDRAWAL || input.amount > this.MAX_WITHDRAWAL) throw new AppError('Nominal pencairan harus Rp10.000 sampai Rp5.000.000.', 400);
    if (!['BANK_TRANSFER', 'EWALLET'].includes(input.method)) throw new AppError('Metode pencairan tidak valid.', 400);
    if (!input.destinationProvider?.trim() || !input.destinationAccount?.trim() || !input.destinationName?.trim()) throw new AppError('Data rekening/e-wallet tujuan wajib lengkap.', 400);
    if (input.destinationAccount.trim().length < 5 || input.destinationAccount.trim().length > 40) throw new AppError('Nomor rekening/e-wallet tidak valid.', 400);

    const minimumRetained = await this.minimumRetainedBalance(user.role);
    const wallet = await this.walletRepo.findOrCreateByUserId(userId);
    const result = await prisma.$transaction(async (tx) => {
      const openCount = await tx.withdrawalRequest.count({ where: { userId, status: { in: ['PENDING_REVIEW', 'PENDING_TRANSFER', 'APPROVED', 'PROCESSING'] } } });
      if (openCount >= 3) throw new AppError('Maksimal 3 permintaan pencairan aktif.', 409);
      const request = await tx.withdrawalRequest.create({ data: { userId, amount: input.amount, method: input.method as any, destinationProvider: input.destinationProvider.trim(), destinationAccount: input.destinationAccount.trim(), destinationName: input.destinationName.trim(), note: input.note?.trim() || null } });
      const { count } = await tx.wallet.updateMany({
        where: { id: wallet.id, balance: { gte: input.amount + minimumRetained }, earningsBalance: { gte: input.amount } },
        data: { balance: { decrement: input.amount }, earningsBalance: { decrement: input.amount } },
      });
      if (count !== 1) throw new AppError(`Penghasilan yang dapat dicairkan tidak mencukupi. Saldo top-up tidak dapat dicairkan dan saldo minimum Rp${minimumRetained.toLocaleString('id-ID')} harus tetap tersimpan.`, 400);
      await tx.transaction.create({ data: { walletId: wallet.id, type: 'WITHDRAWAL_HOLD', amount: -input.amount, description: `Dana ditahan untuk pencairan ${request.id}`, idempotencyKey: `withdrawal-hold-${request.id}` } });
      return request;
    });
    SocketService.emitToAdmins('withdrawal_request_created', { requestId: result.id, userId, role: user.role, amount: input.amount });
    logger.info(`[WITHDRAWAL] Request created: ${result.id} - ${user.role} ${userId} - Rp${input.amount}`);
    // Self-service: tidak menunggu keputusan Admin. Provider/webhook menjadi
    // sumber kebenaran; kegagalan otomatis mengembalikan dana yang ditahan.
    return this.payoutService.initiate(result.id);
  }

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
    proofImageUrl?: string,
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
    const validMethods = ['BANK_TRANSFER', 'QRIS', 'EWALLET', 'TRANSFER', 'CASH'];
    if (!validMethods.includes(method)) {
      throw new AppError('Invalid payment method', 400);
    }

    // 🔒 Bukti pembayaran wajib untuk metode non-tunai.
    // CASH diverifikasi secara fisik oleh kasir/agen, sehingga tidak wajib foto bukti.
    const normalizedProofImageUrl = proofImageUrl?.trim() || undefined;
    if (method !== 'CASH' && (!normalizedProofImageUrl || normalizedProofImageUrl.length < 10)) {
      throw new AppError('Valid proof image is required', 400);
    }

    // 🔒 Cek request duplikat. Untuk CASH, identitas duplikat tidak bergantung pada foto bukti.
    const existingDuplicate = await prisma.topupRequest.findFirst({
      where: {
        userId,
        amount,
        method: method as any,
        status: 'PENDING_REVIEW',
        ...(method === 'CASH' ? {} : { proofImageUrl: normalizedProofImageUrl }),
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
        proofImageUrl: normalizedProofImageUrl ?? null,
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
