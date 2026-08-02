import { Router } from 'express';
import { ReportController } from './report.controller';
import { reportQuerySchema } from '../../core/validation/schemas';
import { authenticateToken, authorizeRoles } from '../../core/middleware/auth.middleware';
import { validateQuery } from '../../core/middleware/validation.middleware';

// PERBAIKAN: sebelumnya file ini pakai require() + tebak-tebakan bentuk
// export ("typeof authMiddleware === 'function' ? ... : Object.values(...)[0]")
// untuk mengambil middleware — sangat rapuh, karena auth.middleware.ts
// mengekspor BEBERAPA named export (authenticateToken, authorizeRoles,
// AuthenticatedRequest), bukan satu default/fungsi tunggal. Object.values(...)[0]
// akan mengambil APA PUN yang kebetulan urutan pertama saat di-compile — bisa
// salah middleware sama sekali tanpa ada error yang jelas. Diganti ke import
// langsung, konsisten dengan seluruh file route lain di project ini.

const router = Router();
const controller = new ReportController();

// Laporan cuma untuk ADMIN — samakan dengan endpoint export sinkron di
// /api/admin/export/(excel|pdf).
router.get(
  '/:type',
  authenticateToken as any,
  authorizeRoles('ADMIN') as any,
  validateQuery(reportQuerySchema) as any,
  controller.triggerReport as any
);

export const reportRoutes = router;
