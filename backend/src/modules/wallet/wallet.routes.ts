import { Router } from 'express';
import { WalletController } from './wallet.controller';
import { WalletAdminController } from './wallet.admin.controller';
import { authenticateToken, authorizeRoles } from '../../core/middleware/auth.middleware';
import { validateBody } from '../../core/middleware/validation.middleware';
import { topupSchema } from '../../core/validation/schemas';

const router = Router();
const walletController = new WalletController();
const walletAdminController = new WalletAdminController();

// ============================================================
// 🔒 USER ROUTES - WALLET
// ============================================================

router.get('/balance', authenticateToken as any, walletController.getBalance as any);
router.get('/transactions', authenticateToken as any, walletController.getTransactions as any);
router.post(
  '/topup-request',
  authenticateToken as any,
  validateBody(topupSchema),
  walletController.createTopupRequest as any
);
router.get(
  '/topup-requests/me',
  authenticateToken as any,
  walletController.getMyTopupRequests as any
);
router.post(
  '/topup',
  authenticateToken as any,
  validateBody(topupSchema),
  walletController.topup as any
);

// ============================================================
// 🔒 ADMIN ROUTES - WALLET
// ============================================================

router.get(
  '/admin/topup/pending',
  authenticateToken as any,
  authorizeRoles('ADMIN') as any,
  walletAdminController.listPending as any
);

router.post(
  '/admin/topup/:requestId/approve',
  authenticateToken as any,
  authorizeRoles('ADMIN') as any,
  walletAdminController.approve as any
);

router.post(
  '/admin/topup/:requestId/reject',
  authenticateToken as any,
  authorizeRoles('ADMIN') as any,
  walletAdminController.reject as any
);

// CATATAN: endpoint kredit saldo admin (POST /api/admin/wallet/credit)
// DIDAFTARKAN DI admin.routes.ts (bukan di sini), supaya path-nya persis
// /api/admin/wallet/credit sesuai dokumentasi keamanan sebelumnya --
// walletRouter ini sendiri sudah ter-mount di /api/wallet, jadi kalau
// didaftarkan di sini path-nya akan jadi /api/wallet/admin/wallet/credit.
// walletAdminController diexport lewat wallet.admin.controller.ts dan
// dipakai ulang (instance baru) di admin.routes.ts.

export const walletRouter = router;