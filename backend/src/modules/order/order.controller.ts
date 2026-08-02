import { Response } from 'express';
import { AuthenticatedRequest } from '../../core/middleware/auth.middleware';
import { OrderService } from './order.service';
import { AppError } from '../../core/errors/AppError';
import { logger } from '../../config/logger';
import { AuditLogger } from '../../core/logging/audit.logger';

// NOTE: Broadcast Socket.IO (order_created/order_accepted/order_status_changed, dst.)
// SUDAH ditangani di dalam OrderService — supaya realtime tetap konsisten dari SEMUA
// jalur pemanggilan (controller ini, alias /api/driver/jobs/:id/accept, dsb.), bukan
// cuma dari satu controller. Controller di sini sengaja dibuat tipis (HTTP saja).

export class OrderController {
  private orderService = new OrderService();

  create = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.id;
      const { order, breakdown, dispatch } = await this.orderService.createOrder(userId, req.body);

      await AuditLogger.log(
        userId,
        'CREATE_ORDER',
        `Membuat order ojek #${order.id} tipe ${order.serviceType} senilai Rp${order.price}`
      );

      return res.status(201).json({ message: 'Order perjalanan DHUKNOO berhasil dibuat!', order, breakdown, dispatch });
    } catch (err: any) {
      logger.error('OrderController.create error: %s', err.message);
      const status = err instanceof AppError ? err.statusCode : 500;
      return res.status(status).json({ error: err.message || 'Gagal membuat order.' });
    }
  };

  list = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.id;
      const result = await this.orderService.listForUser(userId);
      return res.status(200).json(result);
    } catch (err: any) {
      logger.error('OrderController.list error: %s', err.message);
      const status = err instanceof AppError ? err.statusCode : 500;
      return res.status(status).json({ error: err.message || 'Gagal mengambil riwayat order.' });
    }
  };

  accept = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.id;
      const { id } = req.params;
      const order = await this.orderService.acceptOrder(userId, id);

      await AuditLogger.log(userId, 'ORDER_ACCEPTED', `Driver menerima order #${id}`);

      return res.status(200).json({ message: 'Order berhasil diterima!', order });
    } catch (err: any) {
      logger.error('OrderController.accept error: %s', err.message);
      const status = err instanceof AppError ? err.statusCode : 500;
      return res.status(status).json({ error: err.message || 'Gagal menerima order.' });
    }
  };

  updateStatus = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.id;
      const { id } = req.params;
      const { status } = req.body;
      const order = await this.orderService.updateStatus(userId, id, status);

      await AuditLogger.log(userId, 'ORDER_STATUS_UPDATE', `Order #${id} status diubah menjadi ${status}`);

      return res.status(200).json({ message: 'Status order berhasil diperbarui!', order });
    } catch (err: any) {
      logger.error('OrderController.updateStatus error: %s', err.message);
      const status = err instanceof AppError ? err.statusCode : 500;
      return res.status(status).json({ error: err.message || 'Gagal memperbarui status order.' });
    }
  };

  sendReceipt = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.id;
      const { id } = req.params;
      const result = await this.orderService.sendReceipt(userId, id);

      await AuditLogger.log(userId, 'RECEIPT_EMAIL_SENT', `Mengirim struk order #${id} ke email`);

      return res.status(200).json({
        message: result.sent
          ? 'Struk berhasil dikirim ke email Anda!'
          : 'Email belum dikonfigurasi di server ini — struk tetap bisa dilihat/di-print langsung dari aplikasi.',
        sent: result.sent,
      });
    } catch (err: any) {
      logger.error('OrderController.sendReceipt error: %s', err.message);
      const status = err instanceof AppError ? err.statusCode : 500;
      return res.status(status).json({ error: err.message || 'Gagal mengirim struk.' });
    }
  };

  getReceiptHtml = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.id;
      const { id } = req.params;
      // PENTING: pakai buildReceipt (bukan sendReceipt) di sini — endpoint ini untuk
      // MELIHAT struk saja. Kalau dulu salah pakai sendReceipt, setiap kali customer
      // buka halaman struk, email akan terkirim ulang tanpa mereka minta.
      const { html } = await this.orderService.buildReceipt(userId, id);
      return res.status(200).send(html);
    } catch (err: any) {
      logger.error('OrderController.getReceiptHtml error: %s', err.message);
      const status = err instanceof AppError ? err.statusCode : 500;
      return res.status(status).json({ error: err.message || 'Gagal mengambil struk.' });
    }
  };

  getChatHistory = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.id;
      const { id } = req.params;
      const messages = await this.orderService.getChatHistory(userId, id);
      return res.status(200).json({ messages });
    } catch (err: any) {
      logger.error('OrderController.getChatHistory error: %s', err.message);
      const status = err instanceof AppError ? err.statusCode : 500;
      return res.status(status).json({ error: err.message || 'Gagal mengambil riwayat chat.' });
    }
  };
}
