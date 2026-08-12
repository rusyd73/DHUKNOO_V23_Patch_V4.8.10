import { Router } from 'express';
import { authenticateToken, authorizeRoles } from '../../core/middleware/auth.middleware';
import { validateBody } from '../../core/middleware/validation.middleware';
import { topupSchema } from '../../core/validation/schemas';
import { WalletController } from '../wallet/wallet.controller';

const router = Router();
const walletController = new WalletController();

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