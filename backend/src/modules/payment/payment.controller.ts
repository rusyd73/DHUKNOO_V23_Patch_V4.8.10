import { Response } from 'express';
import { AuthenticatedRequest } from '../../core/middleware/auth.middleware';
import { PaymentService } from './payment.service';
import { AppError } from '../../core/errors/AppError';
import { logger } from '../../config/logger';
import { AuditLogger } from '../../core/logging/audit.logger';
import { QueueService } from '../../jobs/bullmq';

export class PaymentController {
  private paymentService = new PaymentService();

  charge = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.id;
      const { orderId, idempotencyKey } = req.body;

      const result = await this.paymentService.chargeOrder(userId, orderId, idempotencyKey);

      if (result.alreadyProcessed) {
        return res.status(200).json({
          message: 'Pembayaran untuk order ini sudah pernah diproses sebelumnya.',
          order: result.order,
        });
      }

      await AuditLogger.log(userId, 'ORDER_PAYMENT', `Membayar order #${orderId} via saldo wallet.`);

      if (result.order?.driverId) {
        await QueueService.addNotificationJob(
          result.order.driverId,
          'Pembayaran Diterima!',
          `Pembayaran untuk order #${orderId} telah masuk ke wallet Anda.`
        );
      }

      return res.status(200).json({
        message: 'Pembayaran berhasil! Saldo telah dipotong dan dikreditkan ke driver.',
        order: result.order,
        transaction: result.customerTransaction,
      });
    } catch (err: any) {
      logger.error('PaymentController.charge error: %s', err.message);
      const status = err instanceof AppError ? err.statusCode : 500;
      return res.status(status).json({ error: err.message || 'Gagal memproses pembayaran.' });
    }
  };

  confirmCash = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.id;
      const { orderId } = req.body;
      const result = await this.paymentService.confirmCash(userId, orderId);

      if (!result.alreadyProcessed) {
        await AuditLogger.log(userId, 'CASH_PAYMENT_CONFIRMED', `Driver konfirmasi cash diterima untuk order #${orderId}`);
      }

      return res.status(200).json({
        message: result.alreadyProcessed
          ? 'Order ini sudah pernah dikonfirmasi lunas sebelumnya.'
          : 'Pembayaran cash dikonfirmasi! Komisi platform telah dipotong dari deposit Anda.',
        order: result.order,
      });
    } catch (err: any) {
      logger.error('PaymentController.confirmCash error: %s', err.message);
      const status = err instanceof AppError ? err.statusCode : 500;
      return res.status(status).json({ error: err.message || 'Gagal mengonfirmasi pembayaran cash.' });
    }
  };

  submitProof = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.id;
      const { orderId, method, proofImageUrl, note } = req.body;
      const proof = await this.paymentService.submitPaymentProof(userId, orderId, method, proofImageUrl, note);

      await AuditLogger.log(userId, 'PAYMENT_PROOF_SUBMITTED', `Upload bukti bayar ${method} untuk order #${orderId}`);

      return res.status(201).json({ message: 'Bukti bayar berhasil diupload! Menunggu peninjauan Admin.', proof });
    } catch (err: any) {
      logger.error('PaymentController.submitProof error: %s', err.message);
      const status = err instanceof AppError ? err.statusCode : 500;
      return res.status(status).json({ error: err.message || 'Gagal mengupload bukti bayar.' });
    }
  };

  listPendingProofs = async (_req: AuthenticatedRequest, res: Response) => {
    try {
      const result = await this.paymentService.listPendingProofs();
      return res.status(200).json(result);
    } catch (err: any) {
      logger.error('PaymentController.listPendingProofs error: %s', err.message);
      return res.status(500).json({ error: 'Gagal mengambil daftar bukti bayar.' });
    }
  };

  reviewProof = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const adminId = req.user!.id;
      const { proofId } = req.params;
      const { status, reviewNote } = req.body;
      const result = await this.paymentService.reviewPaymentProof(adminId, proofId, status, reviewNote);

      await AuditLogger.log(adminId, 'PAYMENT_PROOF_REVIEWED', `Bukti bayar #${proofId} ditandai ${status}`);

      if (status === 'APPROVED' && result.order.driverId) {
        await QueueService.addNotificationJob(
          result.order.driverId,
          'Pembayaran Disetujui!',
          `Bukti bayar order #${result.order.id} disetujui, pendapatan sudah masuk ke wallet Anda.`
        );
      }

      return res.status(200).json({
        message: status === 'APPROVED' ? 'Bukti bayar disetujui, pendapatan driver telah dikreditkan!' : 'Bukti bayar ditolak.',
        proof: result.proof,
      });
    } catch (err: any) {
      logger.error('PaymentController.reviewProof error: %s', err.message);
      const status = err instanceof AppError ? err.statusCode : 500;
      return res.status(status).json({ error: err.message || 'Gagal meninjau bukti bayar.' });
    }
  };
}
