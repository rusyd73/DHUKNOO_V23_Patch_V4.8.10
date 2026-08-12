import { Response } from 'express';
import { AuthenticatedRequest } from '../../core/middleware/auth.middleware';
import { WalletService } from './wallet.service';
import { AppError } from '../../core/errors/AppError';
import { logger } from '../../config/logger';
import { AuditLogger } from '../../core/logging/audit.logger';
import { prisma } from '../../config/prisma';

export class WalletController {
  private walletService = new WalletService();

  // ============================================================
  // 🔒 GET BALANCE
  // ============================================================
  getBalance = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.id;
      const wallet = await this.walletService.getBalance(userId);
      return res.status(200).json({ wallet });
    } catch (err: any) {
      logger.error('WalletController.getBalance error: %s', err.message);
      const status = err instanceof AppError ? err.statusCode : 500;
      return res.status(status).json({ error: err.message || 'Gagal mengambil saldo wallet.' });
    }
  };

  // ============================================================
  // 🔒 GET TRANSACTION HISTORY
  // ============================================================
  getTransactions = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.id;
      const limit = req.query.limit ? Number(req.query.limit) : 50;
      const offset = req.query.offset ? Number(req.query.offset) : 0;
      const result = await this.walletService.getTransactionHistory(userId, limit, offset);
      return res.status(200).json(result);
    } catch (err: any) {
      logger.error('WalletController.getTransactions error: %s', err.message);
      const status = err instanceof AppError ? err.statusCode : 500;
      return res.status(status).json({ error: err.message || 'Gagal mengambil riwayat transaksi.' });
    }
  };

  // ============================================================
  // 🔒 REQUEST TOPUP (DENGAN VALIDASI)
  // ============================================================
  createTopupRequest = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.id;
      const { amount, method, proofImageUrl, note } = req.body;

      // 🔒 Validasi input
      const parsedAmount = Number(amount);
      if (isNaN(parsedAmount) || parsedAmount < 5000) {
        return res.status(400).json({ error: 'Nominal top-up minimal adalah Rp 5.000!' });
      }

      if (!method) {
        return res.status(400).json({ error: 'Payment method is required' });
      }

      if (!proofImageUrl) {
        return res.status(400).json({ error: 'Proof image is required' });
      }

      // 🔒 Normalisasi method
      const normalizedMethod = method === 'PAYMENT_LINK' ? 'TRANSFER' : method;

      // 🔒 Panggil service dengan validasi
      const topupRequest = await this.walletService.requestTopup(
        userId,
        parsedAmount,
        normalizedMethod,
        proofImageUrl,
        note
      );

      await AuditLogger.log(
        userId,
        'WALLET_TOPUP_REQUESTED',
        `Permintaan top-up Rp${parsedAmount.toLocaleString('id-ID')} (${normalizedMethod})`
      );

      return res.status(201).json({
        success: true,
        message: 'Permintaan top-up berhasil diajukan! Menunggu peninjauan dan konfirmasi Admin.',
        data: topupRequest,
        requiresAdminApproval: true,
      });

    } catch (err: any) {
      logger.error('WalletController.createTopupRequest error: %s', err.message);
      const status = err instanceof AppError ? err.statusCode : 500;
      return res.status(status).json({
        success: false,
        error: err.message || 'Gagal mengajukan permintaan top-up.',
      });
    }
  };

  // ============================================================
  // 🔒 GET MY TOPUP REQUESTS
  // ============================================================
  getMyTopupRequests = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.id;
      const { limit = 20, offset = 0 } = req.query;

      const result = await this.walletService.getTopupHistory(
        userId,
        Number(limit),
        Number(offset)
      );

      return res.status(200).json({
        success: true,
        data: result.data,
        pagination: result.pagination,
      });

    } catch (err: any) {
      logger.error('WalletController.getMyTopupRequests error: %s', err.message);
      return res.status(500).json({
        success: false,
        error: err.message || 'Gagal mengambil riwayat permintaan top-up.',
      });
    }
  };

// ============================================================
// 🔒 LEGACY TOPUP ENDPOINT - SEKARANG SELALU LEWAT ANTREAN REVIEW
//
// 🆕 AUDIT KEAMANAN KRITIS: bypass 'role===ADMIN' yang dulu ada di sini
// DIHAPUS TOTAL. Bypass itu langsung mengkredit wallet PEMANGGIL SENDIRI
// (this.walletService.topup(userId, ...) dengan userId = admin yang
// memanggil) tanpa review, tanpa target eksplisit, tanpa alasan, tanpa
// batas nominal -- admin manapun bisa mencetak saldo tak terbatas ke
// akun sendiri hanya dengan memanggil endpoint ini langsung.
//
// SEKARANG: endpoint ini (dan flow topup-request) SELALU membuat
// TopupRequest berstatus PENDING_REVIEW, SIAPA PUN pemanggilnya,
// termasuk ADMIN. Tidak ada jalur "langsung topup ke diri sendiri" lagi.
//
// Jalur sah admin menambah saldo user LAIN (bukan diri sendiri) sekarang
// HANYA lewat POST /api/admin/wallet/credit (lihat admin.routes.ts +
// WalletAdminService.creditUserWallet) -- wajib target eksplisit +
// alasan, tidak bisa menyasar diri sendiri, dibatasi Rp50 juta/transaksi,
// full audit log.
// ============================================================
topup = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const { amount, method, proofImageUrl, note } = req.body;
    const parsedAmount = Number(amount);

    if (isNaN(parsedAmount) || parsedAmount < 5000) {
      return res.status(400).json({ error: 'Nominal top-up minimal adalah Rp 5.000!' });
    }

    const normalizedMethod = method === 'PAYMENT_LINK' ? 'TRANSFER' : method;
    const topupRequest = await this.walletService.requestTopup(
      userId,
      parsedAmount,
      normalizedMethod || 'TRANSFER',
      proofImageUrl || '',
      note
    );

    await AuditLogger.log(
      userId,
      'WALLET_TOPUP_REQUESTED',
      `Pengajuan top-up saldo Rp${parsedAmount.toLocaleString('id-ID')} (${normalizedMethod || 'TRANSFER'})`
    );

    return res.status(200).json({
      success: true,
      message: 'Permintaan top-up berhasil dikirim! Menunggu verifikasi Admin.',
      data: topupRequest,
      requiresAdminApproval: true,
    });

  } catch (err: any) {
    logger.error('WalletController.topup error: %s', err.message);
    const status = err instanceof AppError ? err.statusCode : 500;
    return res.status(status).json({
      success: false,
      error: err.message || 'Gagal melakukan top-up.',
    });
   }
 };
}