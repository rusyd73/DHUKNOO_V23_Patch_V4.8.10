// services/merchant/merchant.service.ts
import { MerchantRepository } from './merchant.repository';
import { AppError, ForbiddenError, NotFoundError } from '../../core/errors/AppError';
import { AuditLogger } from '../../core/logging/audit.logger';
import { logger } from '../../config/logger';
import bcrypt from 'bcryptjs';
import { prisma } from '../../config/prisma';

// ============================================================
// 🔥 INTERFACES
// ============================================================

interface RegisterMerchantInput {
  name: string;
  category: string;
  address: string;
  latitude: number;
  longitude: number;
  phone: string;
  ownerEmail: string;
  ownerPassword: string;
  ownerFullName: string;
  ownerPhone: string;
  isOpen?: boolean;
}

interface AddProductInput {
  merchantId: string;
  name: string;
  price: number;
  description?: string;
  category?: string;
  imageUrl?: string;
  isAvailable?: boolean;
}

interface UpdateProductInput {
  name?: string;
  price?: number;
  description?: string;
  category?: string;
  imageUrl?: string;
  isAvailable?: boolean;
}

interface UpdateMerchantInput {
  name?: string;
  address?: string;
  phone?: string;
  latitude?: number;
  longitude?: number;
  category?: string;
}

// ============================================================
// 🔥 MERCHANT SERVICE
// ============================================================

export class MerchantService {
  private merchantRepo = new MerchantRepository();

  // ============================================================
  // 1. REGISTER MERCHANT + OWNER
  // ============================================================
  async registerMerchant(input: RegisterMerchantInput) {
    const {
      name,
      category,
      address,
      latitude,
      longitude,
      phone,
      ownerEmail,
      ownerPassword,
      ownerFullName,
      ownerPhone,
      isOpen = true,
    } = input;

    // 1. Cek email sudah terdaftar
    const existingUser = await prisma.user.findUnique({
      where: { email: ownerEmail },
    });

    if (existingUser) {
      throw new AppError('Email sudah terdaftar! Silakan gunakan email lain.', 400);
    }

    // 2. Hash password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(ownerPassword, salt);

    // 3. Buat user dengan role MERCHANT
    const user = await prisma.user.create({
      data: {
        email: ownerEmail,
        passwordHash,
        fullName: ownerFullName,
        role: 'MERCHANT',
        customerProfile: {
          create: {
            phoneNumber: ownerPhone,
            isAppInstalled: true,
          },
        },
      },
    });

    // 4. Buat wallet untuk merchant
    await prisma.wallet.create({
      data: {
        userId: user.id,
        balance: 0,
      },
    });

    // 5. Buat merchant via repository
    const merchant = await this.merchantRepo.createMerchant({
      name,
      category,
      address,
      latitude,
      longitude,
      phone,
      isOpen,
      ownerId: user.id,
    });

    // 6. Audit log
    await AuditLogger.log(
      user.id,
      'MERCHANT_REGISTER',
      `Merchant "${name}" (${category}) berhasil didaftarkan oleh ${ownerFullName}`
    );

    logger.info(`🏪 Merchant "${name}" (${category}) registered by ${ownerFullName}`);

    return {
      merchant: {
        id: merchant.id,
        name: merchant.name,
        category: merchant.category,
        address: merchant.address,
        phone: merchant.phone,
        isOpen: merchant.isOpen,
        latitude: merchant.latitude,
        longitude: merchant.longitude,
      },
      owner: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        phone: ownerPhone,
      },
    };
  }

  // ============================================================
  // 2. ADD PRODUCT
  // ============================================================
  async addProduct(ownerId: string, input: AddProductInput) {
    const { merchantId, name, price, description, category, imageUrl, isAvailable = true } = input;

    // 1. Validasi merchant milik owner via repository
    const merchant = await this.merchantRepo.findById(merchantId);
    if (!merchant) {
      throw new NotFoundError('Merchant tidak ditemukan!');
    }

    if (merchant.ownerId !== ownerId) {
      throw new ForbiddenError('Anda tidak berhak menambah produk untuk merchant ini!');
    }

    if (!merchant.isOpen) {
      throw new AppError('Merchant sedang tutup! Tidak bisa menambah produk.', 400);
    }

    // 2. Tambah produk via repository
    const product = await this.merchantRepo.createProduct({
      merchantId,
      name,
      price,
      description,
      imageUrl,
      isAvailable,
    });

    // 3. Audit log
    await AuditLogger.log(
      ownerId,
      'PRODUCT_ADDED',
      `Produk "${name}" (Rp${price.toLocaleString('id-ID')}) ditambahkan ke merchant "${merchant.name}"`
    );

    logger.info(`📦 Product "${name}" added to merchant "${merchant.name}"`);

    return product;
  }

  // ============================================================
  // 3. UPDATE PRODUCT
  // ============================================================
  async updateProduct(ownerId: string, productId: string, input: UpdateProductInput) {
    // 1. Cek product via repository
    const product = await this.merchantRepo.findProductById(productId);
    if (!product) {
      throw new NotFoundError('Produk tidak ditemukan!');
    }

    // 2. Validasi kepemilikan
    const merchant = await this.merchantRepo.findById(product.merchantId);
    if (!merchant || merchant.ownerId !== ownerId) {
      throw new ForbiddenError('Anda tidak berhak mengubah produk ini!');
    }

    // 3. Update product via repository
    const updated = await this.merchantRepo.updateProduct(productId, input);

    // 4. Audit log
    await AuditLogger.log(
      ownerId,
      'PRODUCT_UPDATED',
      `Produk "${product.name}" diperbarui di merchant "${merchant.name}"`
    );

    logger.info(`📦 Product "${product.name}" updated`);

    return updated;
  }

  // ============================================================
  // 4. DELETE PRODUCT
  // ============================================================
  async deleteProduct(ownerId: string, productId: string) {
    // 1. Cek product via repository
    const product = await this.merchantRepo.findProductById(productId);
    if (!product) {
      throw new NotFoundError('Produk tidak ditemukan!');
    }

    // 2. Validasi kepemilikan
    const merchant = await this.merchantRepo.findById(product.merchantId);
    if (!merchant || merchant.ownerId !== ownerId) {
      throw new ForbiddenError('Anda tidak berhak menghapus produk ini!');
    }

    // 3. Delete product via repository
    await this.merchantRepo.deleteProduct(productId);

    // 4. Audit log
    await AuditLogger.log(
      ownerId,
      'PRODUCT_DELETED',
      `Produk "${product.name}" dihapus dari merchant "${merchant.name}"`
    );

    logger.info(`🗑️ Product "${product.name}" deleted`);

    return { success: true, message: 'Produk berhasil dihapus!' };
  }

  // ============================================================
  // 5. LIST PRODUCTS BY MERCHANT
  // ============================================================
  async listProducts(merchantId: string, includeUnavailable: boolean = false) {
    // 1. Cek merchant ada
    const merchant = await this.merchantRepo.findById(merchantId);
    if (!merchant) {
      throw new NotFoundError('Merchant tidak ditemukan!');
    }

    // 2. Get products via repository
    return this.merchantRepo.findProductsByMerchant(merchantId, {
      includeUnavailable,
    });
  }

  // ============================================================
  // 6. TOGGLE MERCHANT STATUS (Open/Close)
  // ============================================================
  async toggleMerchantStatus(ownerId: string, merchantId: string, isOpen: boolean) {
    // 1. Cek merchant
    const merchant = await this.merchantRepo.findById(merchantId);
    if (!merchant) {
      throw new NotFoundError('Merchant tidak ditemukan!');
    }

    if (merchant.ownerId !== ownerId) {
      throw new ForbiddenError('Anda tidak berhak mengubah status merchant ini!');
    }

    // 2. Toggle status via repository
    const updated = await this.merchantRepo.toggleStatus(merchantId, isOpen);

    // 3. Audit log
    await AuditLogger.log(
      ownerId,
      'MERCHANT_STATUS_TOGGLE',
      `Merchant "${merchant.name}" ${isOpen ? 'dibuka' : 'ditutup'}`
    );

    logger.info(`🏪 Merchant "${merchant.name}" ${isOpen ? '🟢 OPEN' : '🔴 CLOSED'}`);

    return updated;
  }

  // ============================================================
  // 7. GET ALL MERCHANTS (Admin)
  // ============================================================
  async getAllMerchants(options?: {
    isOpen?: boolean;
    category?: string;
    limit?: number;
    offset?: number;
  }) {
    return this.merchantRepo.findAll(options);
  }

  // ============================================================
  // 8. GET MERCHANT BY ID (Detail)
  // ============================================================
  async getMerchantById(merchantId: string) {
    const merchant = await this.merchantRepo.findById(merchantId);
    if (!merchant) {
      throw new NotFoundError('Merchant tidak ditemukan!');
    }
    return merchant;
  }

  // ============================================================
  // 9. GET MERCHANT BY OWNER
  // ============================================================
  async getMerchantByOwner(ownerId: string) {
    const merchant = await this.merchantRepo.findByOwnerId(ownerId);
    if (!merchant) {
      throw new NotFoundError('Merchant tidak ditemukan untuk owner ini!');
    }
    return merchant;
  }

  // ============================================================
  // 10. UPDATE MERCHANT PROFILE
  // ============================================================
  async updateMerchant(ownerId: string, merchantId: string, input: UpdateMerchantInput) {
    // 1. Cek merchant
    const merchant = await this.merchantRepo.findById(merchantId);
    if (!merchant) {
      throw new NotFoundError('Merchant tidak ditemukan!');
    }

    if (merchant.ownerId !== ownerId) {
      throw new ForbiddenError('Anda tidak berhak mengubah merchant ini!');
    }

    // 2. Update via repository
    const updated = await this.merchantRepo.updateMerchant(merchantId, input);

    // 3. Audit log
    await AuditLogger.log(
      ownerId,
      'MERCHANT_UPDATED',
      `Merchant "${merchant.name}" diperbarui`
    );

    logger.info(`🏪 Merchant "${merchant.name}" updated`);

    return updated;
  }

  // ============================================================
  // 11. DELETE MERCHANT
  // ============================================================
  async deleteMerchant(ownerId: string, merchantId: string) {
    // 1. Cek merchant
    const merchant = await this.merchantRepo.findById(merchantId);
    if (!merchant) {
      throw new NotFoundError('Merchant tidak ditemukan!');
    }

    if (merchant.ownerId !== ownerId) {
      throw new ForbiddenError('Anda tidak berhak menghapus merchant ini!');
    }

    // 2. Delete via repository
    await this.merchantRepo.deleteMerchant(merchantId);

    // 3. Audit log
    await AuditLogger.log(
      ownerId,
      'MERCHANT_DELETED',
      `Merchant "${merchant.name}" dihapus`
    );

    logger.info(`🗑️ Merchant "${merchant.name}" deleted`);

    return { success: true, message: 'Merchant berhasil dihapus!' };
  }

  // ============================================================
  // 12. GET MERCHANT STATS
  // ============================================================
  async getMerchantStats(ownerId: string, merchantId: string) {
    // 1. Cek merchant
    const merchant = await this.merchantRepo.findById(merchantId);
    if (!merchant) {
      throw new NotFoundError('Merchant tidak ditemukan!');
    }

    if (merchant.ownerId !== ownerId) {
      throw new ForbiddenError('Anda tidak berhak melihat statistik merchant ini!');
    }

    // 2. Get stats via repository
    return this.merchantRepo.getMerchantStats(merchantId);
  }

  // ============================================================
  // 13. SEARCH MERCHANTS
  // ============================================================
  async searchMerchants(query: string, limit: number = 20) {
    if (!query || query.trim().length < 2) {
      throw new AppError('Minimal 2 karakter untuk pencarian!', 400);
    }
    return this.merchantRepo.searchMerchants(query, limit);
  }

  // ============================================================
  // 14. SEARCH PRODUCTS
  // ============================================================
  async searchProducts(query: string, merchantId?: string, limit: number = 20) {
    if (!query || query.trim().length < 2) {
      throw new AppError('Minimal 2 karakter untuk pencarian!', 400);
    }
    return this.merchantRepo.searchProducts(query, merchantId, limit);
  }

  // ============================================================
  // 15. GET POPULAR MERCHANTS
  // ============================================================
  async getPopularMerchants(limit: number = 10) {
    return this.merchantRepo.getPopularMerchants(limit);
  }

  // ============================================================
  // 16. BULK CREATE PRODUCTS
  // ============================================================
  async bulkAddProducts(
    ownerId: string,
    merchantId: string,
    products: Array<{
      name: string;
      price: number;
      description?: string;
      category?: string;
      imageUrl?: string;
      isAvailable?: boolean;
    }>
  ) {
    // 1. Validasi merchant
    const merchant = await this.merchantRepo.findById(merchantId);
    if (!merchant) {
      throw new NotFoundError('Merchant tidak ditemukan!');
    }

    if (merchant.ownerId !== ownerId) {
      throw new ForbiddenError('Anda tidak berhak menambah produk untuk merchant ini!');
    }

    if (!merchant.isOpen) {
      throw new AppError('Merchant sedang tutup! Tidak bisa menambah produk.', 400);
    }

    if (products.length === 0) {
      throw new AppError('Tidak ada produk yang ditambahkan!', 400);
    }

    // 2. Bulk create via repository
    const result = await this.merchantRepo.createManyProducts(
      products.map(p => ({
        merchantId,
        ...p,
      }))
    );

    // 3. Audit log
    await AuditLogger.log(
      ownerId,
      'PRODUCTS_BULK_ADDED',
      `${result.count} produk ditambahkan ke merchant "${merchant.name}"`
    );

    logger.info(`📦 ${result.count} products added to merchant "${merchant.name}"`);

    return {
      success: true,
      message: `${result.count} produk berhasil ditambahkan!`,
      count: result.count,
    };
  }

  // ============================================================
  // 17. VALIDATION HELPERS (Public)
  // ============================================================

  /**
   * Cek apakah merchant milik owner (public helper)
   */
  async isMerchantOwner(merchantId: string, ownerId: string): Promise<boolean> {
    return this.merchantRepo.isMerchantOwner(merchantId, ownerId);
  }

  /**
   * Cek apakah merchant open
   */
  async isMerchantOpen(merchantId: string): Promise<boolean> {
    return this.merchantRepo.isMerchantOpen(merchantId);
  }

  /**
   * Cek apakah product available
   */
  async isProductAvailable(productId: string): Promise<boolean> {
    return this.merchantRepo.isProductAvailable(productId);
  }
}