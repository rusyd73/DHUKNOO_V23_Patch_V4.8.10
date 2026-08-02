import { Router } from 'express';
import { PaymentController } from './payment.controller';
import { authenticateToken } from '../../core/middleware/auth.middleware';
import { authorizeRoles } from '../../core/middleware/auth.middleware';
import { validateBody } from '../../core/middleware/validation.middleware';
import {
  chargeOrderSchema,
  confirmCashSchema,
  submitPaymentProofSchema,
  reviewPaymentProofSchema,
} from '../../core/validation/schemas';

const router = Router();
const paymentController = new PaymentController();

// Hanya CUSTOMER yang bisa membayar order miliknya sendiri (metode WALLET).
// idempotencyKey WAJIB dikirim client (mis. UUID yang dibuat sekali per aksi "bayar")
// agar retry akibat koneksi putus tidak memotong saldo dua kali.
router.post(
  '/charge',
  authenticateToken as any,
  authorizeRoles('CUSTOMER') as any,
  validateBody(chargeOrderSchema),
  paymentController.charge as any
);

// Driver konfirmasi cash sudah diterima (order dengan paymentMethod=CASH)
router.post(
  '/confirm-cash',
  authenticateToken as any,
  authorizeRoles('DRIVER') as any,
  validateBody(confirmCashSchema),
  paymentController.confirmCash as any
);

// Customer upload bukti bayar manual (QRIS/Transfer/E-Wallet)
router.post(
  '/proof',
  authenticateToken as any,
  authorizeRoles('CUSTOMER') as any,
  validateBody(submitPaymentProofSchema),
  paymentController.submitProof as any
);

// Admin: daftar bukti bayar yang menunggu ditinjau
router.get(
  '/proof/pending',
  authenticateToken as any,
  authorizeRoles('ADMIN') as any,
  paymentController.listPendingProofs as any
);

// Admin: setujui/tolak bukti bayar
router.patch(
  '/proof/:proofId/review',
  authenticateToken as any,
  authorizeRoles('ADMIN') as any,
  validateBody(reviewPaymentProofSchema),
  paymentController.reviewProof as any
);

export const paymentRouter = router;
