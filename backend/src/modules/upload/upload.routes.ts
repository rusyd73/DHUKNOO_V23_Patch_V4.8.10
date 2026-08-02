import { Router, Response } from 'express';
import { authenticateToken, AuthenticatedRequest } from '../../core/middleware/auth.middleware';
import { uploadImage, UPLOADS_PUBLIC_PATH } from './upload.config';
import { logger } from '../../config/logger';

const router = Router();

// Endpoint upload generik — dipakai untuk foto bukti bayar (QRIS/Transfer/E-Wallet)
// dan dokumen verifikasi driver (KTP+selfie, STNK). Mengembalikan URL yang bisa
// langsung dipakai di field `proofImageUrl` / `imageUrl` pada endpoint lain.
router.post('/image', authenticateToken as any, uploadImage.single('image'), (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'File gambar wajib disertakan (field "image")!' });
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
