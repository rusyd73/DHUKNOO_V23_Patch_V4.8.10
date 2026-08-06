// backend/src/modules/merchant/merchant.controller.ts
import { Response } from 'express';
import { AuthenticatedRequest } from '../../core/middleware/auth.middleware';
import { MerchantService } from './merchant.service';
import { AppError } from '../../core/errors/AppError';
import { logger } from '../../config/logger';
import { AuditLogger } from '../../core/logging/audit.logger';

export class MerchantController {
  private merchantService = new MerchantService();

  list = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const category = req.query.category as string | undefined;
      const isOpen = req.query.isOpen !== undefined ? req.query.isOpen === 'true' : undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
      const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;

      const merchants = await this.merchantService.getAllMerchants({
        category,
        isOpen,
        limit,
        offset,
      });

      return res.status(200).json({
        success: true,
        data: merchants,
        count: merchants.length,
      });
    } catch (err: any) {
      logger.error('MerchantController.list error: %s', err.message);
      return res.status(500).json({
        success: false,
        error: 'Gagal mengambil daftar merchant.',
      });
    }
  };

  getDetail = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id } = req.params;
      const merchant = await this.merchantService.getMerchantById(id);

      return res.status(200).json({
        success: true,
        data: merchant,
      });
    } catch (err: any) {
      logger.error('MerchantController.getDetail error: %s', err.message);
      const status = err instanceof AppError ? err.statusCode : 500;
      return res.status(status).json({
        success: false,
        error: err.message || 'Gagal mengambil detail merchant.',
      });
    }
  };

  getMine = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const merchant = await this.merchantService.getMerchantByOwner(req.user!.id);

      return res.status(200).json({
        success: true,
        data: merchant,
      });
    } catch (err: any) {
      logger.error('MerchantController.getMine error: %s', err.message);
      const status = err instanceof AppError ? err.statusCode : 500;
      return res.status(status).json({
        success: false,
        error: err.message || 'Gagal mengambil data toko Anda.',
      });
    }
  };

  register = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const result = await this.merchantService.registerMerchant(req.body);

      await AuditLogger.log(
        result.owner.id,
        'MERCHANT_REGISTER',
        `Merchant "${result.merchant.name}" (${result.merchant.category}) berhasil didaftarkan`
      );

      return res.status(201).json({
        success: true,
        message: 'Merchant berhasil didaftarkan! Silakan login dengan akun owner.',
        data: result,
      });
    } catch (err: any) {
      logger.error('MerchantController.register error: %s', err.message);
      const status = err instanceof AppError ? err.statusCode : 400;
      return res.status(status).json({
        success: false,
        error: err.message || 'Gagal mendaftarkan merchant.',
      });
    }
  };

  create = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const result = await this.merchantService.registerMerchant({
        ...req.body,
        ownerEmail: req.body.email || req.body.ownerEmail,
        ownerPassword: req.body.password || req.body.ownerPassword,
        ownerFullName: req.body.fullName || req.body.ownerFullName,
        ownerPhone: req.body.phone || req.body.ownerPhone,
      });

      await AuditLogger.log(
        req.user!.id,
        'MERCHANT_CREATE_BY_ADMIN',
        `Admin membuat merchant baru: ${result.merchant.name}`
      );

      return res.status(201).json({
        success: true,
        message: 'Merchant berhasil dibuat!',
        data: result,
      });
    } catch (err: any) {
      logger.error('MerchantController.create error: %s', err.message);
      const status = err instanceof AppError ? err.statusCode : 500;
      return res.status(status).json({
        success: false,
        error: err.message || 'Gagal membuat merchant.',
      });
    }
  };

  update = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id } = req.params;
      const merchant = await this.merchantService.updateMerchant(
        req.user!.id,
        id,
        req.body
      );

      await AuditLogger.log(
        req.user!.id,
        'MERCHANT_UPDATE',
        `Memperbarui merchant #${id}: ${merchant.name}`
      );

      return res.status(200).json({
        success: true,
        message: 'Merchant berhasil diperbarui!',
        data: merchant,
      });
    } catch (err: any) {
      logger.error('MerchantController.update error: %s', err.message);
      const status = err instanceof AppError ? err.statusCode : 500;
      return res.status(status).json({
        success: false,
        error: err.message || 'Gagal memperbarui merchant.',
      });
    }
  };

  // 🆕 PERBAIKAN #2: sama seperti getMyStats di atas — route '/my/merchant'
  // (PUT) tidak punya `:id` di URL, jadi tidak bisa memakai `update` biasa
  // (yang mengharuskan `req.params.id`). Selesaikan merchant milik owner
  // yang login dulu lewat token, baru update.
  updateMyMerchant = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const ownerId = req.user!.id;
      const existing = await this.merchantService.getMerchantByOwner(ownerId);
      const merchant = await this.merchantService.updateMerchant(ownerId, existing.id, req.body);

      await AuditLogger.log(ownerId, 'MERCHANT_UPDATE', `Memperbarui toko sendiri: ${merchant.name}`);

      return res.status(200).json({
        success: true,
        message: 'Toko Anda berhasil diperbarui!',
        data: merchant,
      });
    } catch (err: any) {
      logger.error('MerchantController.updateMyMerchant error: %s', err.message);
      const status = err instanceof AppError ? err.statusCode : 500;
      return res.status(status).json({
        success: false,
        error: err.message || 'Gagal memperbarui toko Anda.',
      });
    }
  };

  removeMerchant = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id } = req.params;
      const result = await this.merchantService.deleteMerchant(req.user!.id, id);

      await AuditLogger.log(
        req.user!.id,
        'MERCHANT_DELETE',
        `Menghapus merchant #${id}`
      );

      return res.status(200).json({
        success: true,
        message: result.message || 'Merchant berhasil dihapus!',
      });
    } catch (err: any) {
      logger.error('MerchantController.removeMerchant error: %s', err.message);
      const status = err instanceof AppError ? err.statusCode : 500;
      return res.status(status).json({
        success: false,
        error: err.message || 'Gagal menghapus merchant.',
      });
    }
  };

  toggleStatus = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id } = req.params;
      const { isOpen } = req.body;

      if (isOpen === undefined) {
        return res.status(400).json({
          success: false,
          error: 'Parameter isOpen wajib diisi!',
        });
      }

      const merchant = await this.merchantService.toggleMerchantStatus(
        req.user!.id,
        id,
        isOpen
      );

      await AuditLogger.log(
        req.user!.id,
        'MERCHANT_STATUS_TOGGLE',
        `Merchant #${id} ${isOpen ? 'dibuka' : 'ditutup'}`
      );

      return res.status(200).json({
        success: true,
        message: `Merchant ${isOpen ? 'dibuka' : 'ditutup'}!`,
        data: merchant,
      });
    } catch (err: any) {
      logger.error('MerchantController.toggleStatus error: %s', err.message);
      const status = err instanceof AppError ? err.statusCode : 500;
      return res.status(status).json({
        success: false,
        error: err.message || 'Gagal mengubah status merchant.',
      });
    }
  };

  // 🆕 PERBAIKAN #2: sama seperti getMyStats/updateMyMerchant — route
  // '/my/merchant/toggle' (dipakai tombol Buka/Tutup Toko di Dashboard
  // merchant) tidak punya `:id`, jadi `toggleStatus` biasa selalu gagal
  // "Merchant tidak ditemukan!" untuk pemilik toko. Resolusi lewat token dulu.
  toggleMyMerchantStatus = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const ownerId = req.user!.id;
      const { isOpen } = req.body;

      if (isOpen === undefined) {
        return res.status(400).json({
          success: false,
          error: 'Parameter isOpen wajib diisi!',
        });
      }

      const existing = await this.merchantService.getMerchantByOwner(ownerId);
      const merchant = await this.merchantService.toggleMerchantStatus(ownerId, existing.id, isOpen);

      await AuditLogger.log(
        ownerId,
        'MERCHANT_STATUS_TOGGLE',
        `Toko sendiri "${merchant.name}" ${isOpen ? 'dibuka' : 'ditutup'}`
      );

      return res.status(200).json({
        success: true,
        message: `Toko ${isOpen ? 'dibuka' : 'ditutup'}!`,
        data: merchant,
      });
    } catch (err: any) {
      logger.error('MerchantController.toggleMyMerchantStatus error: %s', err.message);
      const status = err instanceof AppError ? err.statusCode : 500;
      return res.status(status).json({
        success: false,
        error: err.message || 'Gagal mengubah status toko Anda.',
      });
    }
  };

  addMenuItem = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id } = req.params;
      const product = await this.merchantService.addProduct(req.user!.id, {
        merchantId: id,
        name: req.body.name,
        price: req.body.price,
        description: req.body.description,
        imageUrl: req.body.imageUrl,
        isAvailable: req.body.isAvailable ?? true,
      });

      await AuditLogger.log(
        req.user!.id,
        'MERCHANT_MENU_ADD',
        `Menambah menu "${product.name}" ke merchant #${id}`
      );

      return res.status(201).json({
        success: true,
        message: 'Menu berhasil ditambahkan!',
        data: product,
      });
    } catch (err: any) {
      logger.error('MerchantController.addMenuItem error: %s', err.message);
      const status = err instanceof AppError ? err.statusCode : 500;
      return res.status(status).json({
        success: false,
        error: err.message || 'Gagal menambahkan menu.',
      });
    }
  };

  updateMenuItem = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { itemId } = req.params;
      const product = await this.merchantService.updateProduct(
        req.user!.id,
        itemId,
        req.body
      );

      await AuditLogger.log(
        req.user!.id,
        'MERCHANT_MENU_UPDATE',
        `Memperbarui menu #${itemId}`
      );

      return res.status(200).json({
        success: true,
        message: 'Menu berhasil diperbarui!',
        data: product,
      });
    } catch (err: any) {
      logger.error('MerchantController.updateMenuItem error: %s', err.message);
      const status = err instanceof AppError ? err.statusCode : 500;
      return res.status(status).json({
        success: false,
        error: err.message || 'Gagal memperbarui menu.',
      });
    }
  };

  deleteMenuItem = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { itemId } = req.params;
      const result = await this.merchantService.deleteProduct(req.user!.id, itemId);

      await AuditLogger.log(
        req.user!.id,
        'MERCHANT_MENU_DELETE',
        `Menghapus menu #${itemId}`
      );

      return res.status(200).json({
        success: true,
        message: result.message || 'Menu berhasil dihapus!',
      });
    } catch (err: any) {
      logger.error('MerchantController.deleteMenuItem error: %s', err.message);
      const status = err instanceof AppError ? err.statusCode : 500;
      return res.status(status).json({
        success: false,
        error: err.message || 'Gagal menghapus menu.',
      });
    }
  };

  listProducts = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id } = req.params;
      const includeUnavailable = req.query.includeUnavailable === 'true';

      const products = await this.merchantService.listProducts(id, includeUnavailable);

      return res.status(200).json({
        success: true,
        data: products,
        count: products.length,
      });
    } catch (err: any) {
      logger.error('MerchantController.listProducts error: %s', err.message);
      const status = err instanceof AppError ? err.statusCode : 500;
      return res.status(status).json({
        success: false,
        error: err.message || 'Gagal mengambil daftar produk.',
      });
    }
  };

  getStats = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id } = req.params;
      const stats = await this.merchantService.getMerchantStats(req.user!.id, id);

      return res.status(200).json({
        success: true,
        data: stats,
      });
    } catch (err: any) {
      logger.error('MerchantController.getStats error: %s', err.message);
      const status = err instanceof AppError ? err.statusCode : 500;
      return res.status(status).json({
        success: false,
        error: err.message || 'Gagal mengambil statistik merchant.',
      });
    }
  };

  // 🆕 PERBAIKAN #2 (Aktifkan Merchant / Link ke Ekosistem): endpoint
  // GET /my/stats sebelumnya salah dipasangkan ke `getStats` di atas, yang
  // WAJIB `:id` dari route param — padahal route '/my/stats' tidak punya
  // param `:id` sama sekali, jadi `id` selalu `undefined` dan request ini
  // SELALU gagal dengan "Merchant tidak ditemukan!" untuk pemilik toko mana
  // pun. Method ini menyelesaikan merchant milik owner yang login dulu (dari
  // token), baru mengambil statistiknya — tanpa butuh `:id` di URL.
  getMyStats = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const ownerId = req.user!.id;
      const merchant = await this.merchantService.getMerchantByOwner(ownerId);
      const stats = await this.merchantService.getMerchantStats(ownerId, merchant.id);

      return res.status(200).json({
        success: true,
        data: stats,
      });
    } catch (err: any) {
      logger.error('MerchantController.getMyStats error: %s', err.message);
      const status = err instanceof AppError ? err.statusCode : 500;
      return res.status(status).json({
        success: false,
        error: err.message || 'Gagal mengambil statistik toko Anda.',
      });
    }
  };

  search = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const query = req.query.q as string;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 20;

      if (!query) {
        return res.status(400).json({
          success: false,
          error: 'Parameter pencarian (q) wajib diisi!',
        });
      }

      const merchants = await this.merchantService.searchMerchants(query, limit);

      return res.status(200).json({
        success: true,
        data: merchants,
        count: merchants.length,
      });
    } catch (err: any) {
      logger.error('MerchantController.search error: %s', err.message);
      const status = err instanceof AppError ? err.statusCode : 500;
      return res.status(status).json({
        success: false,
        error: err.message || 'Gagal mencari merchant.',
      });
    }
  };

  searchProducts = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const query = req.query.q as string;
      const merchantId = req.query.merchantId as string | undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 20;

      if (!query) {
        return res.status(400).json({
          success: false,
          error: 'Parameter pencarian (q) wajib diisi!',
        });
      }

      const products = await this.merchantService.searchProducts(query, merchantId, limit);

      return res.status(200).json({
        success: true,
        data: products,
        count: products.length,
      });
    } catch (err: any) {
      logger.error('MerchantController.searchProducts error: %s', err.message);
      const status = err instanceof AppError ? err.statusCode : 500;
      return res.status(status).json({
        success: false,
        error: err.message || 'Gagal mencari produk.',
      });
    }
  };

  getPopular = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 10;
      const merchants = await this.merchantService.getPopularMerchants(limit);

      return res.status(200).json({
        success: true,
        data: merchants,
        count: merchants.length,
      });
    } catch (err: any) {
      logger.error('MerchantController.getPopular error: %s', err.message);
      return res.status(500).json({
        success: false,
        error: 'Gagal mengambil merchant populer.',
      });
    }
  };

  bulkAddProducts = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id } = req.params;
      const { products } = req.body;

      if (!products || !Array.isArray(products) || products.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Parameter products (array) wajib diisi!',
        });
      }

      const result = await this.merchantService.bulkAddProducts(
        req.user!.id,
        id,
        products
      );

      await AuditLogger.log(
        req.user!.id,
        'MERCHANT_PRODUCTS_BULK_ADD',
        `${result.count} produk ditambahkan ke merchant #${id}`
      );

      return res.status(201).json({
        success: true,
        message: result.message,
        data: result,
      });
    } catch (err: any) {
      logger.error('MerchantController.bulkAddProducts error: %s', err.message);
      const status = err instanceof AppError ? err.statusCode : 500;
      return res.status(status).json({
        success: false,
        error: err.message || 'Gagal menambahkan produk massal.',
      });
    }
  };
}