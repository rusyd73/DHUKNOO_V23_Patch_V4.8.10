import { Response } from 'express';
import { AuthenticatedRequest } from '../../core/middleware/auth.middleware';
import { WalletAdminService } from './wallet.admin.service';
import { AppError } from '../../core/errors/AppError';
import { logger } from '../../config/logger';

export class WalletAdminController {
  private walletAdminService = new WalletAdminService();

  listPending = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const requests = await this.walletAdminService.listPendingRequests();
      return res.status(200).json({
        success: true,
        data: requests,
        total: requests.length,
      });
    } catch (err: any) {
      logger.error('WalletAdminController.listPending error: %s', err.message);
      const status = err instanceof AppError ? err.statusCode : 500;
      return res.status(status).json({
        success: false,
        error: err.message || 'Gagal mengambil daftar permintaan top-up.',
      });
    }
  };

  approve = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const adminId = req.user!.id;
      const { requestId } = req.params;
      const { reviewNote } = req.body;

      const result = await this.walletAdminService.approveTopup(
        adminId,
        requestId,
        reviewNote
      );

      return res.status(200).json({
        success: true,
        message: 'Top-up request approved successfully',
        data: result,
      });
    } catch (err: any) {
      logger.error('WalletAdminController.approve error: %s', err.message);
      const status = err instanceof AppError ? err.statusCode : 500;
      return res.status(status).json({
        success: false,
        error: err.message || 'Gagal menyetujui permintaan top-up.',
      });
    }
  };

  reject = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const adminId = req.user!.id;
      const { requestId } = req.params;
      const { reason } = req.body;

      if (!reason || reason.trim().length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Reason for rejection is required',
        });
      }

      const result = await this.walletAdminService.rejectTopup(
        adminId,
        requestId,
        reason
      );

      return res.status(200).json({
        success: true,
        message: 'Top-up request rejected',
        data: result,
      });
    } catch (err: any) {
      logger.error('WalletAdminController.reject error: %s', err.message);
      const status = err instanceof AppError ? err.statusCode : 500;
      return res.status(status).json({
        success: false,
        error: err.message || 'Gagal menolak permintaan top-up.',
      });
    }
  };

  // ============================================================
  // 🔒 CREDIT USER WALLET (jalur sah pengganti bypass self-mint lama)
  // ============================================================
  credit = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const adminId = req.user!.id;
      const { targetUserId, amount, reason, idempotencyKey } = req.body;

      const result = await this.walletAdminService.creditUserWallet(
        adminId,
        targetUserId,
        Number(amount),
        reason,
        idempotencyKey
      );

      return res.status(200).json({
        success: true,
        message: (result as any).replayed
          ? 'Request ini sudah pernah diproses sebelumnya (idempotent replay) -- saldo TIDAK dikredit ulang.'
          : 'Saldo user berhasil dikredit.',
        wallet: result.updatedWallet,
        transaction: result.transaction,
      });
    } catch (err: any) {
      logger.error('WalletAdminController.credit error: %s', err.message);
      const status = err instanceof AppError ? err.statusCode : 500;
      return res.status(status).json({
        success: false,
        error: err.message || 'Gagal mengkredit saldo user.',
      });
    }
  };
}