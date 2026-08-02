import { Router } from 'express';
import { NotificationController } from './notification.controller';
import { authenticateToken } from '../../core/middleware/auth.middleware';

const router = Router();
const notificationController = new NotificationController();

// Riwayat notifikasi/aktivitas milik user yang sedang login (dipakai ulang dari ActivityLog)
router.get('/', authenticateToken as any, notificationController.list as any);

export const notificationRouter = router;
