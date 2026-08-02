import { prisma } from '../../config/prisma';

export class PromoRepository {
  findActiveByCode(code: string) {
    return prisma.promo.findFirst({
      where: { code: code.toUpperCase(), isActive: true },
    });
  }

  listActive() {
    return prisma.promo.findMany({
      where: {
        isActive: true,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  incrementUsage(id: string) {
    return prisma.promo.update({
      where: { id },
      data: { usedCount: { increment: 1 } },
    });
  }

  create(data: {
    code: string;
    type: 'PERCENTAGE' | 'FIXED';
    value: number;
    maxDiscount?: number;
    minOrderPrice?: number;
    quota?: number;
    expiresAt?: string;
  }) {
    return prisma.promo.create({
      data: {
        code: data.code.toUpperCase(),
        type: data.type,
        value: data.value,
        maxDiscount: data.maxDiscount,
        minOrderPrice: data.minOrderPrice ?? 0,
        quota: data.quota ?? 0,
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
      },
    });
  }
}
