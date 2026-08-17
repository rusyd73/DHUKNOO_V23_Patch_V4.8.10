// modules/file/file.routes.ts
import { Router } from 'express';
import multer from 'multer';
import { FileController } from './file.controller';
import { authenticateToken } from '../../core/middleware/auth.middleware';
import { uploadRateLimiter } from '../../core/middleware/rateLimit.middleware';

const router = Router();
const fileController = new FileController();

// 🆕 FIX P1 "Upload security harus disatukan" (audit): SEBELUMNYA multer
// di sini TIDAK PUNYA fileFilter/MIME allowlist SAMA SEKALI -- endpoint
// /api/files/upload menerima file JENIS APAPUN tanpa validasi (.exe,
// .php, .html, .sh, dst), berbeda dengan modul upload/ (foto bukti
// bayar) yang setidaknya sudah membatasi mimetype. Modul ini dipakai
// juga untuk dokumen verifikasi driver (KTP, selfie, STNK) yang bisa
// berupa foto ATAU scan PDF, jadi allowlist-nya mencakup gambar + PDF.
//
// Sama seperti modul upload/, ini baru validasi LAPIS PERTAMA berbasis
// header Content-Type (bisa dipalsukan client) + ekstensi nama file.
// Validasi UTAMA berbasis ISI FILE SUNGGUHAN (magic bytes) dilakukan
// di FileService.saveFile() SETELAH file diterima -- lihat
// shared/security/fileSignature.ts.
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const ALLOWED_EXTENSIONS: Record<string, string[]> = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/webp': ['.webp'],
  'application/pdf': ['.pdf'],
};

// Multer untuk upload file
const upload = multer({
  dest: 'uploads/temp/',
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      return cb(new Error('Jenis file tidak diizinkan! Hanya gambar (JPEG/PNG/WebP) atau PDF.'));
    }
    const ext = require('path').extname(file.originalname).toLowerCase();
    const allowedExts = ALLOWED_EXTENSIONS[file.mimetype];
    if (!allowedExts || !allowedExts.includes(ext)) {
      return cb(new Error('Ekstensi file tidak sesuai dengan jenis file yang diklaim!'));
    }
    cb(null, true);
  },
});

// ============================================================
// 🔒 FILE ROUTES - SEMUA DENGAN AUTH
// ============================================================

// Upload file
router.post(
  '/upload',
  authenticateToken as any,
  uploadRateLimiter,
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