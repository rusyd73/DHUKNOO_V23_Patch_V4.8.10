import { Router } from 'express';
import { WalletController } from './wallet.controller';
import { authenticateToken } from '../../core/middleware/auth.middleware';
import { validateBody } from '../../core/middleware/validation.middleware';
import { topupSchema } from '../../core/validation/schemas';

const router = Router();
const walletController = new WalletController();

// Semua endpoint wallet membutuhkan user yang sudah login (CUSTOMER, DRIVER, atau ADMIN)
router.get('/balance', authenticateToken as any, walletController.getBalance as any);
router.get('/transactions', authenticateToken as any, walletController.getTransactions as any);
router.post('/topup-request', authenticateToken as any, validateBody(topupSchema), walletController.createTopupRequest as any);
router.get('/topup-requests/me', authenticateToken as any, walletController.getMyTopupRequests as any);
router.post('/topup', authenticateToken as any, validateBody(topupSchema), walletController.topup as any);

export const walletRouter = router;
