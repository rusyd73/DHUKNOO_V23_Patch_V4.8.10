// modules/file/file.service.ts
import { prisma } from '../../config/prisma';
import { AppError } from '../../core/errors/AppError';
import { logger } from '../../config/logger';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { detectFileKind } from '../../shared/security/fileSignature';

const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads');

// Ekstensi final ditentukan dari jenis file yang TERDETEKSI lewat magic
// bytes (bukan dari file.originalname milik client) -- lihat saveFile().
const EXTENSION_BY_KIND: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
};

export class FileService {
  // ============================================================
  // 🔒 SAVE FILE INFO KE DATABASE
  // ============================================================
  async saveFile(
    userId: string,
    role: string,
    type: string,
    entityId: string,
    file: Express.Multer.File
  ) {
    // 🆕 FIX P1 "Upload security harus disatukan" (audit): SEBELUMNYA
    // file langsung dipindah dari folder temp ke uploads/ tanpa validasi
    // ISI file sama sekali -- fileFilter multer di file.routes.ts (baru
    // ditambahkan) hanya mengecek header Content-Type yang diklaim
    // client, yang trivial dipalsukan. Sekarang, SEBELUM dipindah
    // permanen, beberapa byte pertama file dibaca dan dicocokkan dengan
    // magic bytes JPEG/PNG/WEBP/PDF asli. Kalau tidak cocok dengan
    // format manapun yang diizinkan, file temp dihapus dan upload
    // ditolak -- tidak pernah tersimpan permanen atau tercatat di DB.
    const header = Buffer.alloc(16);
    const fd = fs.openSync(file.path, 'r');
    fs.readSync(fd, header, 0, 16, 0);
    fs.closeSync(fd);

    const detectedKind = detectFileKind(header);
    if (!detectedKind) {
      fs.unlink(file.path, () => {});
      logger.warn(`[FILE] Upload ditolak -- isi file tidak cocok dengan format gambar/PDF yang diizinkan (user: ${userId}, originalName: ${file.originalname}).`);
      throw new AppError('Isi file tidak sesuai dengan format yang diizinkan (JPEG/PNG/WebP/PDF)!', 400);
    }

    // Generate unique file ID -- ekstensi dari JENIS TERDETEKSI, bukan
    // dari file.originalname client (mencegah nama file aneh/berbahaya
    // ikut menentukan ekstensi penyimpanan).
    const fileId = crypto.randomUUID();
    const ext = EXTENSION_BY_KIND[detectedKind];
    const fileName = `${fileId}${ext}`;
    const filePath = path.join(UPLOAD_DIR, fileName);

    // Simpan file ke disk
    if (!fs.existsSync(UPLOAD_DIR)) {
      fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    }

    // Pindahkan file dari temp ke uploads
    fs.renameSync(file.path, filePath);

    // Simpan metadata ke database -- mimeType disimpan dari hasil deteksi
    // konten SUNGGUHAN (detectedKind), bukan klaim header client, supaya
    // Content-Type yang dikirim balik saat getFile() juga akurat.
    const fileRecord = await prisma.file.create({
      data: {
        id: fileId,
        userId,
        type,
        entityId,
        originalName: file.originalname,
        path: filePath,
        mimeType: detectedKind,
        size: file.size,
        createdAt: new Date(),
      },
    });

    logger.info(`[FILE] Saved file ${fileId} for user ${userId} (${type})`);

    return {
      id: fileId,
      originalName: file.originalname,
      mimeType: detectedKind,
      size: file.size,
      url: `/api/files/${fileId}`,
    };
  }

  // ============================================================
  // 🔒 GET FILE INFO
  // ============================================================
  async getFileInfo(fileId: string) {
    return prisma.file.findUnique({
      where: { id: fileId },
    });
  }

  // ============================================================
  // 🔒 CHECK AUTHORIZATION
  // ============================================================
  async checkAuthorization(
    userId: string,
    role: string,
    fileInfo: any
  ): Promise<boolean> {
    // Admin bisa melihat semua file
    if (role === 'ADMIN') {
      return true;
    }

    // User hanya bisa melihat file miliknya sendiri
    if (fileInfo.userId === userId) {
      return true;
    }

    // 🔒 CEK BERDASARKAN TIPE FILE
    switch (fileInfo.type) {
      case 'PAYMENT_PROOF':
        // Customer hanya bisa melihat payment proof miliknya
        const order = await prisma.order.findUnique({
          where: { id: fileInfo.entityId },
          include: { customer: true },
        });
        if (order?.customer?.userId === userId) {
          return true;
        }
        break;

      case 'DRIVER_DOCUMENT':
        // Driver hanya bisa melihat dokumen miliknya
        const driver = await prisma.driverProfile.findUnique({
          where: { userId },
        });
        if (driver && driver.id === fileInfo.entityId) {
          return true;
        }
        break;

      case 'PRODUCT_IMAGE':
        // Merchant hanya bisa melihat produk miliknya
        const product = await prisma.product.findUnique({
          where: { id: fileInfo.entityId },
          include: { merchant: true },
        });
        if (product?.merchant?.ownerId === userId) {
          return true;
        }
        break;

      case 'MERCHANT_IMAGE':
        const merchant = await prisma.merchant.findUnique({
          where: { id: fileInfo.entityId },
        });
        if (merchant?.ownerId === userId) {
          return true;
        }
        break;
    }

    return false;
  }

  // ============================================================
  // 🔒 DELETE FILE
  // ============================================================
  async deleteFile(fileId: string, userId: string, role: string) {
    const fileInfo = await this.getFileInfo(fileId);
    if (!fileInfo) {
      throw new AppError('File not found', 404);
    }

    // Check authorization
    const isAuthorized = await this.checkAuthorization(userId, role, fileInfo);
    if (!isAuthorized) {
      throw new AppError('Forbidden', 403);
    }

    // Hapus dari disk
    if (fs.existsSync(fileInfo.path)) {
      fs.unlinkSync(fileInfo.path);
    }

    // Hapus dari database
    await prisma.file.delete({
      where: { id: fileId },
    });

    return { success: true };
  }
}