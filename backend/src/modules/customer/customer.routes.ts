import { Router, Response } from 'express';
import { authenticateToken, authorizeRoles, AuthenticatedRequest } from '../../core/middleware/auth.middleware';
import { validateBody } from '../../core/middleware/validation.middleware';
import { topupSchema } from '../../core/validation/schemas';
import { WalletController } from '../wallet/wallet.controller';
import { prisma } from '../../config/prisma';
import { OrderService } from '../order/order.service';
import { AppError } from '../../core/errors/AppError';
import { logger } from '../../config/logger';

const router = Router();
const walletController = new WalletController();
const orderService = new OrderService();

// ============================================================
// 🆕 FIX P0 "Network menunjukkan /me dan /orders customer 404" (audit
// driver-jobs). SEBELUMNYA route ini TIDAK PERNAH ADA di backend --
// packages/shared-api/index.ts sudah lama mendefinisikan
// `customer.profile: '/api/customer/me'` dan
// `customer.orders: '/api/customer/orders'`, dan frontend/src/pages/
// CustomerApp.tsx (halaman utama customer) SUDAH memanggil keduanya
// lewat CustomerAPI.getProfile()/getOrders() sejak awal -- tapi
// endpoint-nya sendiri tidak pernah diimplementasikan di sisi backend.
// Setiap kali halaman customer dibuka, DUA request pertama yang
// dikirim SELALU 404, dan `profileData`/`ordersData` di frontend
// selamanya undefined (nama & saldo wallet tidak pernah tampil,
// daftar order tidak pernah muncul) -- persis "network menunjukkan
// /me dan /orders customer 404" yang dilaporkan audit.
//
// Response shape disamakan PERSIS dengan yang sudah dikonsumsi
// CustomerApp.tsx (dicek langsung dari source, bukan diasumsikan):
//   GET /me     -> { id, email, fullName, profile, wallet } (flat,
//                   TANPA wrapper .data -- konsisten dengan
//                   GET /api/driver/me yang sudah ada duluan)
//   GET /orders -> { role, orders } (persis output OrderService.listForUser(),
//                   endpoint yang sama yang sudah dipakai GET /api/order)
// ============================================================

router.get(
  '/me',
  authenticateToken as any,
  authorizeRoles('CUSTOMER') as any,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.id;
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          customerProfile: true,
          wallet: {
            include: {
              transactions: { orderBy: { createdAt: 'desc' }, take: 10 },
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
      logger.error('CustomerRoutes./me error: %s', err.message);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }
);

router.get(
  '/orders',
  authenticateToken as any,
  authorizeRoles('CUSTOMER') as any,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.id;
      // Method yang sama persis dengan GET /api/order (order.routes.ts) --
      // sengaja dipakai ulang, bukan query terpisah, supaya dua endpoint
      // ini tidak bisa "berbeda pendapat" soal order mana saja milik
      // customer ini.
      const result = await orderService.listForUser(userId);
      return res.status(200).json(result);
    } catch (err: any) {
      logger.error('CustomerRoutes./orders error: %s', err.message);
      const status = err instanceof AppError ? err.statusCode : 500;
      return res.status(status).json({ error: err.message || 'Gagal mengambil riwayat order.' });
    }
  }
);

// ============================================================
// 🔒 WALLET ROUTES (AMAN)
// ============================================================

// Request topup (butuh approval admin)
router.post(
  '/wallet/topup-request',
  authenticateToken as any,
  authorizeRoles('CUSTOMER') as any,
  validateBody(topupSchema),
  walletController.createTopupRequest as any
);

// Riwayat topup request
router.get(
  '/wallet/topup-requests',
  authenticateToken as any,
  authorizeRoles('CUSTOMER') as any,
  walletController.getMyTopupRequests as any
);

// Saldo
router.get(
  '/wallet/balance',
  authenticateToken as any,
  authorizeRoles('CUSTOMER') as any,
  walletController.getBalance as any
);

// Riwayat transaksi
router.get(
  '/wallet/transactions',
  authenticateToken as any,
  authorizeRoles('CUSTOMER') as any,
  walletController.getTransactions as any
);

// ============================================================
// ❌ LEGACY ENDPOINT - DINONAKTIFKAN
// ============================================================
// POST /wallet/topup - TIDAK AKTIF (BERBAHAYA)
// ============================================================

// ============================================================
// 🔒 CUSTOMER PROFILE ROUTES (jika ada)
// ============================================================
// router.get('/profile', ...);
// router.put('/profile', ...);

export const customerRouter = router;