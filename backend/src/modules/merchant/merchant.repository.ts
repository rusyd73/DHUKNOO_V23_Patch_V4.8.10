// backend/src/modules/merchant/merchant.repository.ts
import { prisma } from '../../config/prisma';
import { Merchant, Product } from '@prisma/client';

export class MerchantRepository {
  
  // ============================================================
  // 🔥 MERCHANT OPERATIONS
  // ============================================================

  async createMerchant(data: {
    name: string;
    category: string;
    address: string;
    latitude: number;
    longitude: number;
    phone: string;
    isOpen: boolean;
    ownerId: string;
  }): Promise<Merchant> {
    return prisma.merchant.create({
      data: {
        name: data.name,
        category: data.category,
        address: data.address,
        latitude: data.latitude,
        longitude: data.longitude,
        phone: data.phone,
        isOpen: data.isOpen,
        ownerId: data.ownerId,
      },
    });
  }

  async findById(merchantId: string): Promise<Merchant | null> {
    return prisma.merchant.findUnique({
      where: { id: merchantId },
      include: {
        owner: {
          select: {
            id: true,
            email: true,
            fullName: true,
          },
        },
        products: {
          where: { isAvailable: true },
          orderBy: { name: 'asc' },
        },
        _count: {
          select: { products: true },
        },
      },
    });
  }

  async findByOwnerId(ownerId: string): Promise<Merchant | null> {
    return prisma.merchant.findUnique({
      where: { ownerId },
      include: {
        products: {
          orderBy: { name: 'asc' },
        },
        // 🆕 nama pemilik akun (identitas login), beda dari nama toko —
        // dipakai untuk menampilkan "Nama Pemilik" di dashboard merchant.
        owner: {
          select: { fullName: true, email: true },
        },
      },
    });
  }

  async findAll(options?: {
    isOpen?: boolean;
    category?: string;
    limit?: number;
    offset?: number;
  }): Promise<Merchant[]> {
    const { isOpen, category, limit, offset } = options || {};

    return prisma.merchant.findMany({
      where: {
        ...(isOpen !== undefined && { isOpen }),
        ...(category && { category }),
      },
      include: {
        owner: {
          select: {
            id: true,
            email: true,
            fullName: true,
          },
        },
        products: {
          where: { isAvailable: true },
          select: { id: true, name: true, price: true },
        },
        _count: {
          select: { products: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      ...(limit && { take: limit }),
      ...(offset && { skip: offset }),
    });
  }

  async updateMerchant(
    merchantId: string,
    data: {
      name?: string;
      category?: string;
      address?: string;
      latitude?: number;
      longitude?: number;
      phone?: string;
      isOpen?: boolean;
    }
  ): Promise<Merchant> {
    return prisma.merchant.update({
      where: { id: merchantId },
      data,
    });
  }

  async toggleStatus(merchantId: string, isOpen: boolean): Promise<Merchant> {
    return prisma.merchant.update({
      where: { id: merchantId },
      data: { isOpen },
    });
  }

  async deleteMerchant(merchantId: string): Promise<Merchant> {
    return prisma.merchant.delete({
      where: { id: merchantId },
    });
  }

  // ============================================================
  // 🔥 PRODUCT OPERATIONS
  // ============================================================

  async createProduct(data: {
    merchantId: string;
    name: string;
    price: number;
    description?: string;
    imageUrl?: string;
    isAvailable?: boolean;
  }): Promise<Product> {
    return prisma.product.create({
      data: {
        merchantId: data.merchantId,
        name: data.name,
        price: data.price,
        description: data.description,
        imageUrl: data.imageUrl,
        isAvailable: data.isAvailable ?? true,
      },
    });
  }

  async findProductById(productId: string): Promise<Product | null> {
    return prisma.product.findUnique({
      where: { id: productId },
      include: {
        merchant: true,
      },
    });
  }

  async findProductsByMerchant(
    merchantId: string,
    options?: {
      includeUnavailable?: boolean;
      limit?: number;
      offset?: number;
    }
  ): Promise<Product[]> {
    const { includeUnavailable = false, limit, offset } = options || {};

    return prisma.product.findMany({
      where: {
        merchantId,
        ...(includeUnavailable ? {} : { isAvailable: true }),
      },
      orderBy: { name: 'asc' },
      ...(limit && { take: limit }),
      ...(offset && { skip: offset }),
    });
  }

  async updateProduct(
    productId: string,
    data: {
      name?: string;
      price?: number;
      description?: string;
      imageUrl?: string;
      isAvailable?: boolean;
    }
  ): Promise<Product> {
    return prisma.product.update({
      where: { id: productId },
      data,
    });
  }

  async deleteProduct(productId: string): Promise<Product> {
    return prisma.product.delete({
      where: { id: productId },
    });
  }

  async createManyProducts(
    data: Array<{
      merchantId: string;
      name: string;
      price: number;
      description?: string;
      imageUrl?: string;
      isAvailable?: boolean;
    }>
  ): Promise<{ count: number }> {
    return prisma.product.createMany({
      data,
    });
  }

  // ============================================================
  // 🔥 STATISTICS
  // ============================================================

  async getMerchantStats(merchantId: string) {
    const productCount = await prisma.product.count({
      where: { merchantId, isAvailable: true },
    });

    const orderCount = await prisma.order.count({
      where: {
        status: 'COMPLETED',
      },
    });

    const totalRevenue = await prisma.order.aggregate({
      where: {
        status: 'COMPLETED',
        isPaid: true,
      },
      _sum: {
        price: true,
      },
    });

    return {
      productCount,
      orderCount,
      totalRevenue: totalRevenue._sum?.price || 0,
    };
  }

  async getPopularMerchants(limit: number = 10) {
    return prisma.merchant.findMany({
      include: {
        owner: {
          select: {
            fullName: true,
            email: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: limit,
    });
  }

  // ============================================================
  // 🔥 SEARCH
  // ============================================================

  async searchMerchants(query: string, limit: number = 20) {
    return prisma.merchant.findMany({
      where: {
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { category: { contains: query, mode: 'insensitive' } },
          { address: { contains: query, mode: 'insensitive' } },
        ],
      },
      include: {
        owner: {
          select: {
            fullName: true,
          },
        },
        products: {
          where: { isAvailable: true },
          take: 5,
        },
      },
      take: limit,
    });
  }

  async searchProducts(query: string, merchantId?: string, limit: number = 20) {
    return prisma.product.findMany({
      where: {
        AND: [
          { name: { contains: query, mode: 'insensitive' } },
          { isAvailable: true },
          ...(merchantId ? [{ merchantId }] : []),
        ],
      },
      include: {
        merchant: {
          select: {
            id: true,
            name: true,
            isOpen: true,
          },
        },
      },
      take: limit,
    });
  }

  // ============================================================
  // 🔥 VALIDATION HELPERS
  // ============================================================

  async isMerchantOwner(merchantId: string, ownerId: string): Promise<boolean> {
    const merchant = await prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { ownerId: true },
    });
    return merchant?.ownerId === ownerId;
  }

  async isMerchantOpen(merchantId: string): Promise<boolean> {
    const merchant = await prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { isOpen: true },
    });
    return merchant?.isOpen ?? false;
  }

  async isProductAvailable(productId: string): Promise<boolean> {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { isAvailable: true },
    });
    return product?.isAvailable ?? false;
  }
}