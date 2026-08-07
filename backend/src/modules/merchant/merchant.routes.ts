// backend/src/modules/merchant/merchant.routes.ts
import express from 'express';
import { MerchantController } from './merchant.controller';
// ✅ IMPORT YANG BENAR - auth.middleware.ts
import { authenticateToken, authorizeRoles } from '../../core/middleware/auth.middleware';
import { logger } from '../../config/logger';

const router = express.Router();
const merchantController = new MerchantController();

// ============================================================
// 🔥 HEALTH CHECK
// ============================================================
router.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Merchant routes are working!',
    timestamp: new Date().toISOString(),
  });
});

// ============================================================
// 🔥 PUBLIC ROUTES
// ============================================================
router.get('/', merchantController.list);
router.get('/search', merchantController.search);
router.get('/popular', merchantController.getPopular);
router.get('/:id', merchantController.getDetail);
router.get('/:id/products', merchantController.listProducts);
router.post('/register', merchantController.register);
router.get('/products/search', merchantController.searchProducts);

// ============================================================
// 🔥 AUTHENTICATED ROUTES
// ============================================================
router.use(authenticateToken);

// Merchant Owner
router.get('/my/merchant', authorizeRoles('MERCHANT'), merchantController.getMine);
// ✅ PERBAIKAN #2: sebelumnya route '/my/...' ini memakai method yang
// mewajibkan `:id` di URL (update/toggleStatus/getStats) — padahal route
// ini tidak punya `:id` sama sekali, jadi SELALU gagal "Merchant tidak
// ditemukan!" untuk pemilik toko manapun. Sekarang pakai varian "My*" yang
// menyelesaikan merchant lewat token login (req.user.id), bukan URL param.
router.put('/my/merchant', authorizeRoles('MERCHANT'), merchantController.updateMyMerchant);
router.patch('/my/merchant/toggle', authorizeRoles('MERCHANT'), merchantController.toggleMyMerchantStatus);
router.get('/my/stats', authorizeRoles('MERCHANT'), merchantController.getMyStats);
// 🆕 (Link Merchant <-> Order): pesanan yang masuk ke toko sendiri.
router.get('/my/orders', authorizeRoles('MERCHANT'), merchantController.getMyOrders);
router.post('/my/products', authorizeRoles('MERCHANT'), merchantController.addMenuItem);
router.post('/my/products/bulk', authorizeRoles('MERCHANT'), merchantController.bulkAddProducts);
router.put('/my/products/:itemId', authorizeRoles('MERCHANT'), merchantController.updateMenuItem);
router.delete('/my/products/:itemId', authorizeRoles('MERCHANT'), merchantController.deleteMenuItem);

// Admin
router.post('/', authorizeRoles('ADMIN'), merchantController.create);
router.put('/:id', authorizeRoles('ADMIN'), merchantController.update);
// ✅ Ganti 'delete' menjadi 'removeMerchant'
router.delete('/:id', authorizeRoles('ADMIN'), merchantController.removeMerchant);
router.patch('/:id/toggle', authorizeRoles('ADMIN'), merchantController.toggleStatus);
router.get('/:id/stats', authorizeRoles('ADMIN'), merchantController.getStats);

// ============================================================
// 🔥 404 HANDLER
// ============================================================
router.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: `Route ${req.originalUrl} tidak ditemukan di merchant routes.`,
  });
});

export default router;