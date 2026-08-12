import { prisma } from '../../config/prisma';
import { ServiceType } from '@prisma/client';

export class TariffRepository {
  findActiveRule(serviceType: ServiceType, zoneId?: string) {
    return prisma.pricingRule.findFirst({
      where: {
        serviceType,
        isActive: true,
        zoneId: zoneId ?? undefined,
      },
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  findFallbackRule(serviceType: ServiceType) {
    return prisma.pricingRule.findFirst({
      where: { serviceType, isActive: true, zoneId: null },
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  findActiveRegionalPolicy(zoneId: string) {
    return prisma.regionalPolicy.findFirst({
      where: { zoneId, isActive: true },
      orderBy: { updatedAt: 'desc' },
    });
  }

  findActiveTariffVersion() {
    return prisma.tariffVersion.findFirst({ where: { isActive: true } });
  }

  findZoneByName(name: string) {
    return prisma.pricingZone.findUnique({ where: { name } });
  }

  savePricingHistory(orderId: string, tariffVersionId: string | null, breakdown: object) {
    return prisma.pricingHistory.create({
      data: { orderId, tariffVersionId, breakdown: breakdown as any },
    });
  }

  // ── Admin CRUD ──────────────────────────────────────────────────────
  listZones() {
    return prisma.pricingZone.findMany({ orderBy: { name: 'asc' } });
  }

  createZone(name: string) {
    return prisma.pricingZone.create({ data: { name } });
  }

  listRules(zoneId?: string) {
    return prisma.pricingRule.findMany({
      where: zoneId ? { zoneId } : undefined,
      include: { zone: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  createRule(data: {
    zoneId?: string;
    serviceType: ServiceType;
    baseFare: number;
    pickupFee?: number;
    perKmFee: number;
    perMinuteWaitFee?: number;
  }) {
    return prisma.pricingRule.create({ data });
  }

  updateRule(id: string, data: Partial<{
    baseFare: number;
    pickupFee: number;
    perKmFee: number;
    perMinuteWaitFee: number;
    isActive: boolean;
  }>) {
    return prisma.pricingRule.update({ where: { id }, data });
  }

  listRegionalPolicies() {
    return prisma.regionalPolicy.findMany({ include: { zone: true }, orderBy: { createdAt: 'desc' } });
  }

  createRegionalPolicy(data: {
    zoneId: string;
    tollFee?: number;
    parkingFee?: number;
    weatherSurcharge?: number;
    holidaySurcharge?: number;
  }) {
    return prisma.regionalPolicy.create({ data });
  }

  updateRegionalPolicy(id: string, data: Partial<{
    tollFee: number;
    parkingFee: number;
    weatherSurcharge: number;
    holidaySurcharge: number;
    isActive: boolean;
  }>) {
    return prisma.regionalPolicy.update({ where: { id }, data });
  }

  listTariffVersions() {
    return prisma.tariffVersion.findMany({ orderBy: { createdAt: 'desc' } });
  }

  createTariffVersion(versionName: string, commissionTiers: object, description?: string) {
    return prisma.tariffVersion.create({
      data: { versionName, commissionTiers: commissionTiers as any, description },
    });
  }

  async activateTariffVersion(id: string) {
    return prisma.$transaction([
      prisma.tariffVersion.updateMany({ where: { isActive: true }, data: { isActive: false } }),
      prisma.tariffVersion.update({ where: { id }, data: { isActive: true, activatedAt: new Date() } }),
    ]);
  }

  getConfig(key: string) {
    return prisma.platformConfig.findUnique({ where: { key } });
  }

  upsertConfig(key: string, value: string, description?: string) {
    return prisma.platformConfig.upsert({
      where: { key },
      create: { key, value, description },
      update: { value, description },
    });
  }

  listConfig() {
    return prisma.platformConfig.findMany({ orderBy: { key: 'asc' } });
  }

  async getDashboardSummary(range: 'daily' | 'weekly' | 'monthly') {
    const rangeDays = range === 'daily' ? 1 : range === 'weekly' ? 7 : 30;
    const since = new Date();
    since.setDate(since.getDate() - rangeDays);

    const [totalOrders, completedOrders, cancelledOrders, statusBreakdown, revenueAgg, commissionAgg, earningAgg] =
      await Promise.all([
        prisma.order.count({ where: { createdAt: { gte: since } } }),
        prisma.order.count({ where: { createdAt: { gte: since }, status: 'COMPLETED' } }),
        prisma.order.count({ where: { createdAt: { gte: since }, status: 'CANCELLED' } }),
        prisma.order.groupBy({
          by: ['status'],
          where: { createdAt: { gte: since } },
          _count: { _all: true },
        }),
        prisma.order.aggregate({
          where: { createdAt: { gte: since }, isPaid: true },
          _sum: { price: true, discount: true },
        }),
        prisma.transaction.aggregate({
          where: { type: 'PLATFORM_FEE', createdAt: { gte: since } },
          _sum: { amount: true },
        }),
        prisma.transaction.aggregate({
          where: { type: 'EARNING', createdAt: { gte: since } },
          _sum: { amount: true },
        }),
      ]);

    const grossRevenue = Number(revenueAgg._sum.price || 0) - Number(revenueAgg._sum.discount || 0);
    const totalPlatformCommissionRupiah = Math.abs(Number(commissionAgg._sum.amount || 0));
    const totalDriverEarningRupiah = Number(earningAgg._sum.amount || 0);

    return {
      range,
      since,
      totalOrders,
      completedOrders,
      cancelledOrders,
      grossRevenue,
      totalPlatformCommissionRupiah,
      totalDriverEarningRupiah,
      statusBreakdown: statusBreakdown.map((s) => ({ status: s.status, count: s._count._all })),
    };
  }

  // ============================================================
  // 🔒 HOLIDAY
  // ============================================================

  async findHoliday(date: string): Promise<any> {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(date);
    end.setHours(23, 59, 59, 999);

    return prisma.holiday.findFirst({
      where: {
        date: {
          gte: start,
          lte: end,
        },
        isActive: true,
      },
    });
  }
}