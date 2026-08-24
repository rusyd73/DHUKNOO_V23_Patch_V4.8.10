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

  giveTip = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const result = await this.orderService.giveDriverTip(req.user!.id, req.params.id, req.body?.amount);
      return res.status(200).json({ message: 'Tips berhasil dikirim 100% kepada driver.', data: result });
    } catch (err: any) {
      logger.error('OrderController.giveTip error: %s', err.message);
      const status = err instanceof AppError ? err.statusCode : 500;
      return res.status(status).json({ error: err.message || 'Gagal mengirim tips.' });
    }
  };

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

  // 🆕 (Link Merchant <-> Order): checkout keranjang belanja dari satu toko.
  previewMerchantCheckout = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const breakdown = await this.orderService.previewMerchantOrder(req.body);
      return res.status(200).json({ breakdown });
    } catch (err: any) {
      logger.error('OrderController.previewMerchantCheckout error: %s', err.message);
      const status = err instanceof AppError ? err.statusCode : 500;
      return res.status(status).json({ error: err.message || 'Gagal menghitung total pesanan.' });
    }
  };

  checkoutMerchant = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.id;
      const { order, breakdown, dispatch } = await this.orderService.createMerchantOrder(userId, req.body);

      return res.status(201).json({ message: 'Pesanan berhasil dibuat! Menunggu driver mengantar.', order, breakdown, dispatch });
    } catch (err: any) {
      logger.error('OrderController.checkoutMerchant error: %s', err.message);
      const status = err instanceof AppError ? err.statusCode : 500;
      return res.status(status).json({ error: err.message || 'Gagal membuat pesanan dari toko.' });
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
      try {
        await AuditLogger.log(req.user!.id, 'DRIVER_ACCEPT_REJECTED', `Accept order #${req.params.id} ditolak: ${err.message}`);
      } catch {
        // Audit best-effort; respons utama tidak boleh berubah bila audit gagal.
      }
      const status = err instanceof AppError ? err.statusCode : 500;
      return res.status(status).json({ error: err.message || 'Gagal menerima order.' });
    }
  };

  updateStopStatus = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.id;
      const { id, stopId } = req.params;
      const { status } = req.body;
      if (!['ARRIVED', 'COMPLETED'].includes(status)) return res.status(400).json({ error: 'Status tujuan harus ARRIVED atau COMPLETED.' });
      const order = await this.orderService.updateStopStatus(userId, id, stopId, status);
      return res.status(200).json({ message: status === 'ARRIVED' ? 'Tiba di tujuan.' : 'Tujuan selesai, lanjut ke tujuan berikutnya.', order });
    } catch (err: any) {
      logger.error('OrderController.updateStopStatus error: %s', err.message);
      const code = err instanceof AppError ? err.statusCode : 500;
      return res.status(code).json({ error: err.message || 'Gagal memperbarui tujuan.' });
    }
  };

  updateStatus = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.id;
      const { id } = req.params;
      const { status } = req.body;
      const order = await this.orderService.updateStatus(userId, id, status);

      await AuditLogger.log(userId, 'ORDER_STATUS_UPDATE', `Order #${id} status diubah menjadi ${status}`);

      const isMart = order.serviceType === 'MART';
      const isSend = order.serviceType === 'SEND';
      const statusMessage: Record<string, string> = {
        ON_THE_WAY: isMart ? 'Menuju lokasi merchant.' : isSend ? 'Menuju lokasi pengambilan barang.' : 'Menuju lokasi jemput customer.',
        ARRIVED: isMart ? 'Tiba di lokasi merchant.' : isSend ? 'Tiba di lokasi pengambilan barang.' : 'Tiba di lokasi jemput customer.',
        PICKED_UP: isMart ? 'Pesanan diambil dan menuju customer.' : isSend ? 'Barang diambil dan menuju lokasi penerima.' : 'Customer dijemput dan menuju lokasi tujuan.',
        ARRIVED_CUSTOMER: isMart ? 'Tiba di lokasi customer.' : isSend ? 'Tiba di lokasi penerima barang.' : 'Tiba di lokasi tujuan customer.',
        COMPLETED: 'Order telah selesai.',
        CANCELLED: 'Order telah dibatalkan.',
      };
      return res.status(200).json({ message: statusMessage[status] || 'Status order berhasil diperbarui!', order });
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
