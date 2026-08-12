// modules/ledger/ledger.routes.ts
import { Router } from 'express';
import { LedgerController } from './ledger.controller';
import { authenticateToken, authorizeRoles } from '../../core/middleware/auth.middleware';

const router = Router();
const ledgerController = new LedgerController();

// ============================================================
// 🔒 ADMIN ONLY - LEDGER ROUTES
// ============================================================

// Get platform revenue summary
router.get(
  '/platform/revenue',
  authenticateToken as any,
  authorizeRoles('ADMIN') as any,
  ledgerController.getPlatformRevenue as any
);

// Reconcile specific order
router.get(
  '/reconcile/:orderId',
  authenticateToken as any,
  authorizeRoles('ADMIN') as any,
  ledgerController.reconcileOrder as any
);

export const ledgerRouter = router;