import { Router } from 'express';
import { AuthController } from './auth.controller';
import { authenticateToken } from '../../core/middleware/auth.middleware';
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

// Public routes — dibatasi authRateLimiter agar tidak bisa di-brute-force
// (10 percobaan / 15 menit, di-key per kombinasi IP + email yang dicoba)
router.post('/register', authRateLimiter, validateBody(registerSchema), authController.register as any);
router.post('/login', authRateLimiter, validateBody(loginSchema), authController.login as any);
router.post('/refresh', authRateLimiter, authController.refresh as any);

// 🆕 PERBAIKAN #1 — Lupa/Reset Password. Dibatasi authRateLimiter yang sama
// dengan login/register supaya tidak bisa dipakai brute-force menebak kode OTP.
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

// Protected routes
router.get('/profile', authenticateToken as any, authController.getProfile as any);
router.post('/logout', authenticateToken as any, authController.logout as any);
router.post('/change-password', authenticateToken as any, authRateLimiter, validateBody(changePasswordSchema), authController.changePassword as any);

export const authRouter = router;
