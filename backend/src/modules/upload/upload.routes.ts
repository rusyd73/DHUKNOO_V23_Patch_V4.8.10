import { Router, Response } from 'express';
import fs from 'fs';
import { authenticateToken, AuthenticatedRequest } from '../../core/middleware/auth.middleware';
import { uploadImage, UPLOADS_PUBLIC_PATH, UPLOAD_DIR_ABSOLUTE } from './upload.config';
import { logger } from '../../config/logger';
import { isAllowedFileContent } from '../../shared/security/fileSignature';
import { uploadRateLimiter } from '../../core/middleware/rateLimit.middleware';
import path from 'path';

const router = Router();

// Endpoint upload generik — dipakai untuk foto bukti bayar (QRIS/Transfer/E-Wallet)
// dan dokumen verifikasi driver (KTP+selfie, STNK). Mengembalikan URL yang bisa
// langsung dipakai di field `proofImageUrl` / `imageUrl` pada endpoint lain.
router.post('/image', authenticateToken as any, uploadRateLimiter, uploadImage.single('image'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'File gambar wajib disertakan (field "image")!' });
    }

    // 🆕 FIX P1 "Upload security harus disatukan" (audit): uploadImage
    // (multer) SEBELUMNYA hanya memvalidasi `file.mimetype` -- field ini
    // diambil dari header Content-Type yang dikirim CLIENT, bisa
    // dipalsukan trivial (mis. upload file .php/.exe dengan header
    // "image/jpeg"). fileFilter multer lolos begitu saja, dan file APA
    // PUN bisa tersimpan di folder uploads/ yang public-served dengan
    // ekstensi gambar. Sekarang, SETELAH file benar-benar tersimpan,
    // baca beberapa byte pertama ISI FILE SUNGGUHAN dan cocokkan dengan
    // magic bytes JPEG/PNG/WEBP asli (lihat shared/security/fileSignature.ts)
    // -- kalau tidak cocok, file dihapus segera dan request ditolak,
    // TIDAK PERNAH mengembalikan URL yang bisa diakses publik.
    const filePath = path.join(UPLOAD_DIR_ABSOLUTE, req.file.filename);
    const header = Buffer.alloc(16);
    const fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, header, 0, 16, 0);
    fs.closeSync(fd);

    if (!isAllowedFileContent(header, ['image/jpeg', 'image/png', 'image/webp'])) {
      fs.unlink(filePath, () => {});
      logger.warn(`[UPLOAD] File ditolak -- isi file tidak cocok dengan JPEG/PNG/WEBP walau mimetype header mengklaim demikian (user: ${req.user?.id}).`);
      return res.status(400).json({ error: 'Isi file tidak sesuai dengan format gambar yang diizinkan (JPEG/PNG/WebP)!' });
    }

    // PERBAIKAN: sebelumnya URL yang dikembalikan cuma path relatif ("/uploads/xxx.jpg").
    // Disimpan apa adanya di imageUrl/proofImageUrl, lalu dipakai frontend sebagai <a href>/
    // <img src> — karena relatif, browser resolve ke origin HALAMAN YANG SEDANG DIBUKA
    // (localhost:5173, Vite), BUKAN backend (localhost:3000) tempat file itu sebenarnya
    // di-serve. Klik linknya jadi menuju URL yang tidak ada di Vite, dan SPA router jatuh
    // ke halaman utama. Sekarang dikembalikan sebagai URL lengkap (protokol + host + path)
    // supaya benar dibuka dari origin manapun frontend-nya berjalan.
    const url = `${req.protocol}://${req.get('host')}${UPLOADS_PUBLIC_PATH}/${req.file.filename}`;
    return res.status(201).json({ message: 'Upload berhasil!', url });
  } catch (err: any) {
    logger.error('UploadController.image error: %s', err.message);
    return res.status(500).json({ error: err.message || 'Gagal mengupload file.' });
  }
});

export const uploadRouter = router;
