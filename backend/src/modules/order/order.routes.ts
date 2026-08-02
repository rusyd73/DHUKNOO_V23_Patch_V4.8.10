import { Router } from 'express';
import { OrderController } from './order.controller';
import { authenticateToken, authorizeRoles } from '../../core/middleware/auth.middleware';
import { validateBody } from '../../core/middleware/validation.middleware';
import { createOrderSchema, updateOrderStatusSchema } from '../../core/validation/schemas';

const router = Router();
const orderController = new OrderController();

router.post('/', authenticateToken as any, validateBody(createOrderSchema), orderController.create as any);
router.get('/', authenticateToken as any, orderController.list as any);
router.patch('/:id/accept', authenticateToken as any, authorizeRoles('DRIVER') as any, orderController.accept as any);
router.patch(
  '/:id/status',
  authenticateToken as any,
  validateBody(updateOrderStatusSchema),
  orderController.updateStatus as any
);

// Struk perjalanan: lihat HTML-nya langsung, atau kirim ke email (best-effort,
// aman kalau SMTP belum dikonfigurasi — lihat backend/src/config/mailer.ts).
router.get('/:id/receipt', authenticateToken as any, orderController.getReceiptHtml as any);
router.post('/:id/receipt/email', authenticateToken as any, orderController.sendReceipt as any);

// Riwayat chat customer<->driver untuk order ini (dipanggil OrderChatBox saat mount).
router.get('/:id/chat', authenticateToken as any, orderController.getChatHistory as any);

export const orderRouter = router;
