import { prisma } from '../../config/prisma';

export class MerchantRepository {
  findByOwnerId(ownerId: string) {
    return prisma.merchant.findUnique({
      where: { ownerId },
      include: { products: { orderBy: { createdAt: 'asc' } } },
    });
  }

  list(filter?: { category?: string; isOpen?: boolean }) {
    return prisma.merchant.findMany({
      where: {
        ...(filter?.category ? { category: filter.category } : {}),
        ...(filter?.isOpen !== undefined ? { isOpen: filter.isOpen } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  findById(id: string) {
    return prisma.merchant.findUnique({
      where: { id },
      include: { products: { orderBy: { createdAt: 'asc' } } },
    });
  }

  create(data: {
    name: string;
    category: string;
    address: string;
    latitude: number;
    longitude: number;
    phone?: string;
    imageUrl?: string;
  }) {
    return prisma.merchant.create({ data });
  }

  update(id: string, data: Partial<{
    name: string;
    category: string;
    address: string;
    latitude: number;
    longitude: number;
    phone: string;
    imageUrl: string;
    isOpen: boolean;
  }>) {
    return prisma.merchant.update({ where: { id }, data });
  }

  addMenuItem(merchantId: string, data: {
    name: string;
    description?: string;
    price: number;
    imageUrl?: string;
  }) {
    return prisma.product.create({ data: { ...data, merchantId } });
  }

  findMenuItemById(itemId: string) {
    return prisma.product.findUnique({ where: { id: itemId } });
  }

  updateMenuItem(itemId: string, data: Partial<{
    name: string;
    description: string;
    price: number;
    imageUrl: string;
    isAvailable: boolean;
  }>) {
    return prisma.product.update({ where: { id: itemId }, data });
  }
}
