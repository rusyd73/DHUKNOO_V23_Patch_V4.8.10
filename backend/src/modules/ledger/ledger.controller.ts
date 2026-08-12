// modules/ledger/ledger.controller.ts
import { Response } from 'express';
import { AuthenticatedRequest } from '../../core/middleware/auth.middleware';
import { LedgerService } from './ledger.service';
import { AppError } from '../../core/errors/AppError';
import { logger } from '../../config/logger';

export class LedgerController {
  private ledgerService = new LedgerService();

  // ============================================================
  // 🔒 GET PLATFORM REVENUE SUMMARY (ADMIN ONLY)
  // ============================================================
  getPlatformRevenue = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { startDate, endDate } = req.query;

      if (!startDate || !endDate) {
        return res.status(400).json({
          success: false,
          error: 'startDate and endDate are required',
        });
      }

      const summary = await this.ledgerService.getPlatformRevenueSummary(
        new Date(startDate as string),
        new Date(endDate as string)
      );

      return res.status(200).json({
        success: true,
        data: summary,
      });
    } catch (err: any) {
      logger.error('LedgerController.getPlatformRevenue error:', err);
      return res.status(500).json({
        success: false,
        error: err.message || 'Failed to get platform revenue',
      });
    }
  };

  // ============================================================
  // 🔒 RECONCILE ORDER (ADMIN ONLY)
  // ============================================================
  reconcileOrder = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { orderId } = req.params;

      const result = await this.ledgerService.reconcileOrder(orderId);

      return res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      logger.error('LedgerController.reconcileOrder error:', err);
      return res.status(500).json({
        success: false,
        error: err.message || 'Failed to reconcile order',
      });
    }
  };
}