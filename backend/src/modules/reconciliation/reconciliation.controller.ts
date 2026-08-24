import { Response } from 'express';
import { AuthenticatedRequest } from '../../core/middleware/auth.middleware';
import { ReconciliationService } from './reconciliation.service';
import { AppError } from '../../core/errors/AppError';
import { logger } from '../../config/logger';

export class ReconciliationController {
  private reconciliationService = new ReconciliationService();

  listPending = async (_req: AuthenticatedRequest, res: Response) => {
    try {
      const orders = await this.reconciliationService.listPendingReconciliation();
      return res.status(200).json({ success: true, data: orders, total: orders.length });
    } catch (err: any) {
      logger.error('ReconciliationController.listPending error: %s', err.message);
      const status = err instanceof AppError ? err.statusCode : 500;
      return res.status(status).json({ success: false, error: err.message || 'Gagal mengambil daftar order yang perlu direkonsiliasi.' });
    }
  };

  retry = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const adminId = req.user!.id;
      const { orderId } = req.params;

      const result = await this.reconciliationService.retrySettlement(adminId, orderId);

      return res.status(200).json({
        success: true,
        message: result.alreadyProcessed
          ? 'Settlement order ini sudah pernah berhasil sebelumnya (idempotent) -- tidak ada perubahan saldo baru.'
          : 'Settlement berhasil diretry dan sekarang SETTLED.',
        data: result.order,
      });
    } catch (err: any) {
      logger.error('ReconciliationController.retry error: %s', err.message);
      const status = err instanceof AppError ? err.statusCode : 500;
      return res.status(status).json({ success: false, error: err.message || 'Gagal me-retry settlement order ini.' });
    }
  };
}
