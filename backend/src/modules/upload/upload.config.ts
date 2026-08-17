import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

// Untuk versi awal, file disimpan di disk lokal server (folder `uploads/` di root
// backend). Ini cukup untuk development & server tunggal. Untuk produksi dengan
// banyak instance/replika, sebaiknya diganti ke object storage (S3/Cloudinary/dsb) —
// tinggal ganti `storage` di bawah ini, kode pemanggilnya (controller) tidak perlu berubah
// selama tetap mengembalikan URL yang bisa diakses.
const UPLOAD_DIR = path.resolve(__dirname, '../../../uploads');

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const uniqueName = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  },
});

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
// 🆕 FIX P1 "Upload security": ekstensi file HARUS konsisten dengan
// mimetype yang diklaim -- mencegah file bernama "shell.php.jpg" (atau
// bahkan "shell.php" dengan mimetype dipalsukan jadi image/jpeg) lolos
// hanya berdasarkan header Content-Type. Ini validasi TAMBAHAN di sisi
// nama file; validasi UTAMA (isi file sungguhan lewat magic bytes) ada
// di upload.routes.ts SETELAH file tersimpan -- lihat
// shared/security/fileSignature.ts.
const ALLOWED_EXTENSIONS: Record<string, string[]> = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/webp': ['.webp'],
};

export const uploadImage = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      return cb(new Error('Hanya file gambar (JPEG/PNG/WebP) yang diizinkan!'));
    }
    const ext = path.extname(file.originalname).toLowerCase();
    const allowedExts = ALLOWED_MIME_TYPES.includes(file.mimetype) ? ALLOWED_EXTENSIONS[file.mimetype] : [];
    if (!allowedExts || !allowedExts.includes(ext)) {
      return cb(new Error('Ekstensi file tidak sesuai dengan jenis gambar yang diklaim!'));
    }
    cb(null, true);
  },
});

export const UPLOADS_PUBLIC_PATH = '/uploads';
export const UPLOAD_DIR_ABSOLUTE = UPLOAD_DIR;
