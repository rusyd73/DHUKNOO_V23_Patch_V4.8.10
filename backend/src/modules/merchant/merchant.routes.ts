import { Router } from 'express';
import { MerchantController } from './merchant.controller';
import { authenticateToken, authorizeRoles } from '../../core/middleware/auth.middleware';
import { validateBody } from '../../core/middleware/validation.middleware';
import {
  createMerchantSchema,
  updateMerchantSchema,
  addMenuItemSchema,
  updateMenuItemSchema,
} from '../../core/validation/schemas';

const router = Router();
const merchantController = new MerchantController();

// Publik (untuk user yang login): jelajahi merchant kuliner/belanja sekitar Malang-Batu
router.get('/', authenticateToken as any, merchantController.list as any);

// Khusus MERCHANT: lihat data toko miliknya sendiri (dibuat otomatis saat registrasi role MERCHANT)
router.get('/me', authenticateToken as any, authorizeRoles('MERCHANT') as any, merchantController.getMine as any);

router.get('/:id', authenticateToken as any, merchantController.getDetail as any);

// ADMIN bisa membuat merchant baru secara manual (mis. untuk toko yang belum onboarding sendiri)
router.post('/', authenticateToken as any, authorizeRoles('ADMIN') as any, validateBody(createMerchantSchema), merchantController.create as any);

// ADMIN bisa mengelola semua toko; MERCHANT hanya bisa mengelola tokonya sendiri
// (dicek di service layer lewat assertCanManage — bukan cuma role check di sini).
router.patch(
  '/:id',
  authenticateToken as any,
  authorizeRoles('ADMIN', 'MERCHANT') as any,
  validateBody(updateMerchantSchema),
  merchantController.update as any
);
router.post(
  '/:id/menu',
  authenticateToken as any,
  authorizeRoles('ADMIN', 'MERCHANT') as any,
  validateBody(addMenuItemSchema),
  merchantController.addMenuItem as any
);
router.patch(
  '/menu/:itemId',
  authenticateToken as any,
  authorizeRoles('ADMIN', 'MERCHANT') as any,
  validateBody(updateMenuItemSchema),
  merchantController.updateMenuItem as any
);

export const merchantRouter = router;
