import { Router } from 'express';
import { PromoController } from './promo.controller';
import { authenticateToken, authorizeRoles } from '../../core/middleware/auth.middleware';
import { validateBody } from '../../core/middleware/validation.middleware';
import { validatePromoSchema, createPromoSchema } from '../../core/validation/schemas';

const router = Router();
const promoController = new PromoController();

// Publik: siapa saja (yang login) bisa lihat & cek promo aktif
router.get('/', authenticateToken as any, promoController.list as any);
router.post('/validate', authenticateToken as any, validateBody(validatePromoSchema), promoController.validate as any);

// Hanya ADMIN yang bisa membuat kode promo baru
router.post(
  '/',
  authenticateToken as any,
  authorizeRoles('ADMIN') as any,
  validateBody(createPromoSchema),
  promoController.create as any
);

export const promoRouter = router;
