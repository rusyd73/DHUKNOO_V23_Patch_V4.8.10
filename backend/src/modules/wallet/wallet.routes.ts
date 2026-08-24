import { Router, Response, NextFunction } from 'express';
import { WalletController } from './wallet.controller';
import { WalletAdminController } from './wallet.admin.controller';
import { authenticateToken, authorizeRoles } from '../../core/middleware/auth.middleware';
import { validateBody } from '../../core/middleware/validation.middleware';
import { topupSchema } from '../../core/validation/schemas';
import { prisma } from '../../config/prisma';

const router = Router();
const walletController = new WalletController();
const walletAdminController = new WalletAdminController();

// Public hanya dalam arti tanpa JWT user; tetap wajib token webhook provider.
router.post('/payout/webhook/xendit', walletController.xenditPayoutWebhook as any);

// Otorisasi finansial tingkat tinggi: hanya SUPER ADMIN aktif yang boleh
// mengubah status pencairan. Identitas Super Admin mengikuti aturan dashboard:
// SUPER_ADMIN_EMAIL, atau Admin aktif tertua sebagai fallback instalasi lama.
const requireWithdrawalAuthority = async (req: any, res: Response, next: NextFunction) => {
  try {
    const configuredEmail = String(process.env.SUPER_ADMIN_EMAIL || '').trim().toLowerCase();
    const configuredAdmin = configuredEmail
      ? await prisma.user.findFirst({ where: { role: 'ADMIN', isActive: true, email: { equals: configuredEmail, mode: 'insensitive' } }, select: { id: true } })
      : null;
    const superAdmin = configuredAdmin || await prisma.user.findFirst({ where: { role: 'ADMIN', isActive: true }, orderBy: { createdAt: 'asc' }, select: { id: true } });
    if (!superAdmin || superAdmin.id !== req.user?.id) {
      return res.status(403).json({ success: false, error: 'Hanya SUPER ADMIN yang memiliki otorisasi menyetujui dan memproses pencairan.', code: 'WITHDRAWAL_AUTHORITY_REQUIRED' });
    }
    return next();
  } catch {
    return res.status(503).json({ success: false, error: 'Gagal memverifikasi otorisasi pencairan.' });
  }
};

// ============================================================
// 🔒 USER ROUTES - WALLET
// ============================================================

router.get('/balance', authenticateToken as any, walletController.getBalance as any);
router.get('/transactions', authenticateToken as any, walletController.getTransactions as any);
router.get('/withdrawal-requests/me', authenticateToken as any, walletController.getMyWithdrawals as any);
router.post('/withdrawal-requests', authenticateToken as any, walletController.createWithdrawal as any);
router.post(
  '/topup-request',
  authenticateToken as any,
  validateBody(topupSchema),
  walletController.createTopupRequest as any
);

router.get('/admin/withdrawals', authenticateToken as any, authorizeRoles('ADMIN') as any, walletAdminController.listWithdrawals as any);
router.post('/admin/withdrawals/:requestId/action', authenticateToken as any, authorizeRoles('ADMIN') as any, requireWithdrawalAuthority as any, walletAdminController.reviewWithdrawal as any);
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
