import { Router } from 'express';
import { AuthController } from './auth.controller';
import { authenticateToken, optionalAuthenticateToken } from '../../core/middleware/auth.middleware';
import { validateBody } from '../../core/middleware/validation.middleware';
import { authRateLimiter } from '../../core/middleware/rateLimit.middleware';
import {
  registerSchema,
  loginSchema,
  changePasswordSchema,
  requestPasswordResetSchema,
  confirmPasswordResetSchema,
} from '../../core/validation/schemas';

const router = Router();
const authController = new AuthController();

// ============================================================
// 🔓 PUBLIC ROUTES
// ============================================================

router.post('/register', authRateLimiter, validateBody(registerSchema), authController.register as any);
router.post('/login', authRateLimiter, validateBody(loginSchema), authController.login as any);
router.post('/refresh', authRateLimiter, authController.refreshToken as any);

// ============================================================
// 🔓 PASSWORD RESET ROUTES
// ============================================================

router.post(
  '/reset-password-request',
  authRateLimiter,
  validateBody(requestPasswordResetSchema),
  authController.requestPasswordReset as any
);
router.post(
  '/reset-password-confirm',
  authRateLimiter,
  validateBody(confirmPasswordResetSchema),
  authController.confirmPasswordReset as any
);

// ============================================================
// 🔒 PROTECTED ROUTES
// ============================================================

// 🆕 FIX P0 KONTRAK AUTH: route ini sebelumnya di-comment-out, jadi
// GET /api/auth/profile selalu 404 walau authController.getProfile dan
// seluruh test/consumer mengasumsikan endpoint ini aktif.
router.get('/profile', authenticateToken as any, authController.getProfile as any);
// 🆕 FIX P1 "logout idempotent/ditangani saat token sudah invalid"
// (audit driver-jobs): optionalAuthenticateToken, BUKAN authenticateToken
// -- lihat komentar lengkap di auth.middleware.ts dan auth.controller.ts.
router.post('/logout', optionalAuthenticateToken as any, authController.logout as any);
router.post(
  '/change-password',
  authenticateToken as any,
  authRateLimiter,
  validateBody(changePasswordSchema),
  authController.changePassword as any
);

export const authRouter = router;