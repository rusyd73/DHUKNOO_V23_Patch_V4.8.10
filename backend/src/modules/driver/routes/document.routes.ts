import { Router, Response } from "express";
import {
  authenticateToken,
  AuthenticatedRequest,
  authorizeRoles,
} from "../../../core/middleware/auth.middleware";
import { validateBody } from "../../../core/middleware/validation.middleware";
import { prisma } from "../../../config/prisma";
import { AuditLogger } from "../../../core/logging/audit.logger";
import { uploadDriverDocumentSchema } from "../../../core/validation/schemas";

const router = Router();

// ── Verifikasi Dokumen Driver (KTP+selfie, STNK) ──────────────────────────
// Driver upload foto dulu (pakai POST /api/upload/image untuk dapatkan URL-nya),
// baru kirim URL itu ke sini. Admin meninjau lewat endpoint di admin.routes.ts.
router.post(
  '/documents',
  authenticateToken as any,
  authorizeRoles('DRIVER') as any,
  validateBody(uploadDriverDocumentSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.id;
      const { type, imageUrl } = req.body;

      const driverProfile = await prisma.driverProfile.findUnique({ where: { userId } });
      if (!driverProfile) {
        return res.status(403).json({ error: 'Hanya driver terdaftar yang bisa mengupload dokumen!' });
      }

      const document = await prisma.driverDocument.create({
        data: { driverId: driverProfile.id, type, imageUrl },
      });

      await AuditLogger.log(userId, 'DRIVER_DOCUMENT_UPLOADED', `Upload dokumen ${type}`);

      return res.status(201).json({ message: 'Dokumen berhasil diupload! Menunggu peninjauan Admin.', document });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Gagal mengupload dokumen.' });
    }
  }
);

router.get(
  '/documents/me',
  authenticateToken as any,
  authorizeRoles('DRIVER') as any,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.id;
      const driverProfile = await prisma.driverProfile.findUnique({ where: { userId } });
      if (!driverProfile) {
        return res.status(403).json({ error: 'Profil driver tidak ditemukan!' });
      }
      const documents = await prisma.driverDocument.findMany({
        where: { driverId: driverProfile.id },
        orderBy: { createdAt: 'desc' },
      });
      return res.status(200).json({ documents, isVerified: driverProfile.isVerified });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Gagal mengambil dokumen.' });
    }
  }
);

export { router as documentRouter };
