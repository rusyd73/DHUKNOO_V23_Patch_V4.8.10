import { Router, Response } from 'express';
import { authenticateToken, AuthenticatedRequest, authorizeRoles } from '../../core/middleware/auth.middleware';
import { validateBody } from '../../core/middleware/validation.middleware';
import { createOrderSchema } from '../../core/validation/schemas';
import { prisma } from '../../config/prisma';
import { AuditLogger } from '../../core/logging/audit.logger';
import { z } from 'zod';
import { WalletService } from '../wallet/wallet.service';
import { OrderService } from '../order/order.service';
import { AppError } from '../../core/errors/AppError';

const router = Router();
const walletService = new WalletService();
const orderService = new OrderService();

const topupSchema = z.object({
  amount: z.number().positive('Jumlah top up harus lebih besar dari 0!'),
});

// GET /api/customer/me - Fetch Customer Profile & Wallet
router.get(
  '/me',
  authenticateToken as any,
  authorizeRoles('CUSTOMER') as any,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: 'Tidak terautentikasi' });
      }

      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          customerProfile: true,
          wallet: {
            include: {
              transactions: {
                orderBy: { createdAt: 'desc' },
                take: 10,
              },
            },
          },
        },
      });

      if (!user || !user.customerProfile) {
        return res.status(404).json({ error: 'Profil customer tidak ditemukan!' });
      }

      return res.status(200).json({
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        profile: user.customerProfile,
        wallet: user.wallet,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }
);

// POST /api/customer/wallet/topup - Top up wallet balance
// (Alias historis untuk kompatibilitas frontend lama — logic sebenarnya
//  didelegasikan ke WalletService yang sama dipakai oleh /api/wallet/topup,
//  supaya tidak ada dua implementasi ledger yang bisa berbeda hasilnya.)
router.post(
  '/wallet/topup',
  authenticateToken as any,
  authorizeRoles('CUSTOMER') as any,
  validateBody(topupSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: 'Tidak terautentikasi' });
      }

      const { amount } = req.body;
      const result = await walletService.topup(userId, amount);

      await AuditLogger.log(userId, 'WALLET_TOPUP', `Top up sebesar Rp${amount} sukses.`);

      return res.status(200).json({
        message: 'Top up berhasil!',
        balance: result.wallet.balance,
      });
    } catch (err: any) {
      const status = err instanceof AppError ? err.statusCode : 500;
      return res.status(status).json({ error: err.message });
    }
  }
);

// POST /api/customer/orders - Place a new ride-hailing order
// (Alias historis — logic sebenarnya didelegasikan ke OrderService yang sama
//  dipakai oleh /api/order, supaya dukungan kode promo & diskon konsisten
//  di kedua endpoint.)
router.post(
  '/orders',
  authenticateToken as any,
  authorizeRoles('CUSTOMER') as any,
  validateBody(createOrderSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: 'Tidak terautentikasi' });
      }

      const { order, breakdown } = await orderService.createOrder(userId, req.body);

      await AuditLogger.log(userId, 'CREATE_ORDER', `Membuat order #${order.id} tipe ${order.serviceType} senilai Rp${order.price}`);

      return res.status(201).json({
        message: 'Order perjalanan DHUKNOO berhasil dibuat! Mencari driver terdekat...',
        order,
        breakdown,
      });
    } catch (err: any) {
      const status = err instanceof AppError ? err.statusCode : 500;
      return res.status(status).json({ error: err.message });
    }
  }
);

// GET /api/customer/orders - Get order history for customer
router.get(
  '/orders',
  authenticateToken as any,
  authorizeRoles('CUSTOMER') as any,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: 'Tidak terautentikasi' });
      }

      const customerProfile = await prisma.customerProfile.findUnique({
        where: { userId },
      });

      if (!customerProfile) {
        return res.status(403).json({ error: 'Profil tidak ditemukan' });
      }

      const orders = await prisma.order.findMany({
        where: { customerId: customerProfile.id },
        include: {
          driver: {
            include: {
              user: {
                select: { fullName: true, email: true },
              },
            },
          },
          paymentProof: true,
          // 🆕 (Link Merchant <-> Order): sertakan rincian toko & item belanja
          // supaya UI tracking order (CustomerApp.tsx, memakai query yang
          // sama untuk SEMUA jenis order) bisa menampilkan nama toko & daftar
          // barang untuk order MART, bukan cuma order BIKE/CAR/SEND.
          merchant: { select: { id: true, name: true, phone: true, address: true, imageUrl: true } },
          orderItems: true,
        },
        orderBy: { createdAt: 'desc' },
      });

      return res.status(200).json({ orders });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }
);

export const customerRouter = router;

