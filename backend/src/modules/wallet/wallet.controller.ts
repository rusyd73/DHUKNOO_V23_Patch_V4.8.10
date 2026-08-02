import { Response } from 'express';
import { AuthenticatedRequest } from '../../core/middleware/auth.middleware';
import { WalletService } from './wallet.service';
import { AppError } from '../../core/errors/AppError';
import { logger } from '../../config/logger';
import { AuditLogger } from '../../core/logging/audit.logger';
import { prisma } from '../../config/prisma';

export class WalletController {
  private walletService = new WalletService();

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

  createTopupRequest = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.id;
      const { amount, method, proofImageUrl, note } = req.body;
      const parsedAmount = Number(amount);
      if (isNaN(parsedAmount) || parsedAmount < 5000) {
        return res.status(400).json({ error: 'Nominal top-up minimal adalah Rp 5.000!' });
      }

      // PAYMENT_LINK bukan nilai valid di enum PaymentMethod (schema.prisma) --
      // secara konsep gateway checkout link tetap sejenis TRANSFER, jadi
      // dinormalisasi supaya tidak gagal saat disimpan ke database.
      const normalizedMethod = method === 'PAYMENT_LINK' ? 'TRANSFER' : method;

      const topupRequest = await prisma.topupRequest.create({
        data: {
          userId,
          amount: parsedAmount,
          method: normalizedMethod || 'TRANSFER',
          proofImageUrl: proofImageUrl || null,
          note: note || null,
          status: 'PENDING_REVIEW',
        },
      });

      await AuditLogger.log(userId, 'WALLET_TOPUP_REQUESTED', `Permintaan top-up Rp${parsedAmount.toLocaleString('id-ID')} (${normalizedMethod || 'TRANSFER'})`);

      return res.status(201).json({
        message: 'Permintaan top-up berhasil diajukan! Menunggu peninjauan dan konfirmasi Admin.',
        topupRequest,
      });
    } catch (err: any) {
      logger.error('WalletController.createTopupRequest error: %s', err.message);
      return res.status(500).json({ error: err.message || 'Gagal mengajukan permintaan top-up.' });
    }
  };

  getMyTopupRequests = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.id;
      const requests = await prisma.topupRequest.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      });
      return res.status(200).json({ topupRequests: requests });
    } catch (err: any) {
      logger.error('WalletController.getMyTopupRequests error: %s', err.message);
      return res.status(500).json({ error: err.message || 'Gagal mengambil riwayat permintaan top-up.' });
    }
  };

  topup = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.id;
      const role = req.user!.role;
      const { amount, method, proofImageUrl, note } = req.body;
      const parsedAmount = Number(amount);

      if (isNaN(parsedAmount) || parsedAmount < 5000) {
        return res.status(400).json({ error: 'Nominal top-up minimal adalah Rp 5.000!' });
      }

      // Jika yang melakukan topup adalah ADMIN, saldo langsung ditambahkan
      if (role === 'ADMIN') {
        const result = await this.walletService.topup(userId, parsedAmount);
        await AuditLogger.log(userId, 'ADMIN_DIRECT_TOPUP', `Top-up langsung oleh Admin sebesar Rp${parsedAmount.toLocaleString('id-ID')}`);
        return res.status(200).json({
          message: 'Top-up saldo langsung berhasil!',
          wallet: result.wallet,
          transaction: result.transaction,
        });
      }

      // Jika CUSTOMER atau DRIVER, buatkan TopupRequest (status PENDING_REVIEW).
      // Saldo TIDAK BERTAMBAH OTOMATIS sampai disetujui Admin!
      //
      // PAYMENT_LINK bukan nilai valid di enum PaymentMethod (schema.prisma) --
      // secara konsep gateway checkout link tetap sejenis TRANSFER, jadi
      // dinormalisasi supaya tidak gagal saat disimpan ke database.
      const normalizedMethod = method === 'PAYMENT_LINK' ? 'TRANSFER' : method;

      const topupRequest = await prisma.topupRequest.create({
        data: {
          userId,
          amount: parsedAmount,
          method: normalizedMethod || 'TRANSFER',
          proofImageUrl: proofImageUrl || null,
          note: note || null,
          status: 'PENDING_REVIEW',
        },
      });

      await AuditLogger.log(userId, 'WALLET_TOPUP_REQUESTED', `Pengajuan top-up saldo Rp${parsedAmount.toLocaleString('id-ID')} (${normalizedMethod || 'TRANSFER'})`);

      return res.status(200).json({
        message: 'Permintaan top-up berhasil dikirim! Menunggu verifikasi & persetujuan Admin sebelum saldo bertambah.',
        topupRequest,
        requiresAdminApproval: true,
      });
    } catch (err: any) {
      logger.error('WalletController.topup error: %s', err.message);
      const status = err instanceof AppError ? err.statusCode : 500;
      return res.status(status).json({ error: err.message || 'Gagal melakukan top-up.' });
    }
  };
}

