// modules/file/file.routes.ts
import { Router } from 'express';
import multer from 'multer';
import { FileController } from './file.controller';
import { authenticateToken } from '../../core/middleware/auth.middleware';

const router = Router();
const fileController = new FileController();

// Multer untuk upload file
const upload = multer({
  dest: 'uploads/temp/',
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

// ============================================================
// 🔒 FILE ROUTES - SEMUA DENGAN AUTH
// ============================================================

// Upload file
router.post(
  '/upload',
  authenticateToken as any,
  upload.single('file'),
  fileController.uploadFile as any
);

// Get file (dengan auth)
router.get(
  '/:id',
  authenticateToken as any,
  fileController.getFile as any
);

// Delete file
router.delete(
  '/:id',
  authenticateToken as any,
  fileController.deleteFile as any
);

export const fileRouter = router;