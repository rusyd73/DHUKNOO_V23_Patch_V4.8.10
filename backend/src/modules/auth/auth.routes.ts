import { Router } from 'express';
import { AuthController } from './auth.controller';
import { authenticateToken } from '../../core/middleware/auth.middleware';
import { validateBody } from '../../core/middleware/validation.middleware';
import { authRateLimiter } from '../../core/middleware/rateLimit.middleware';
import { registerSchema, loginSchema, changePasswordSchema } from '../../core/validation/schemas';

const router = Router();
const authController = new AuthController();

// Public routes — dibatasi authRateLimiter agar tidak bisa di-brute-force
// (10 percobaan / 15 menit, di-key per kombinasi IP + email yang dicoba)
router.post('/register', authRateLimiter, validateBody(registerSchema), authController.register as any);
router.post('/login', authRateLimiter, validateBody(loginSchema), authController.login as any);
router.post('/refresh', authRateLimiter, authController.refresh as any);

// Protected routes
router.get('/profile', authenticateToken as any, authController.getProfile as any);
router.post('/change-password', authenticateToken as any, authRateLimiter, validateBody(changePasswordSchema), authController.changePassword as any);

export const authRouter = router;
