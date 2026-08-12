// modules/file/file.service.ts
import { prisma } from '../../config/prisma';
import { AppError } from '../../core/errors/AppError';
import { logger } from '../../config/logger';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads');

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
    // Generate unique file ID
    const fileId = crypto.randomUUID();
    const ext = path.extname(file.originalname);
    const fileName = `${fileId}${ext}`;
    const filePath = path.join(UPLOAD_DIR, fileName);

    // Simpan file ke disk
    if (!fs.existsSync(UPLOAD_DIR)) {
      fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    }

    // Pindahkan file dari temp ke uploads
    fs.renameSync(file.path, filePath);

    // Simpan metadata ke database
    const fileRecord = await prisma.file.create({
      data: {
        id: fileId,
        userId,
        type,
        entityId,
        originalName: file.originalname,
        path: filePath,
        mimeType: file.mimetype,
        size: file.size,
        createdAt: new Date(),
      },
    });

    logger.info(`[FILE] Saved file ${fileId} for user ${userId} (${type})`);

    return {
      id: fileId,
      originalName: file.originalname,
      mimeType: file.mimetype,
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