import { prisma } from '../../config/prisma';

export class ReviewRepository {
  findByOrderId(orderId: string) {
    return prisma.review.findUnique({ where: { orderId } });
  }

  create(data: { orderId: string; driverId: string; rating: number; comment?: string }) {
    return prisma.review.create({ data });
  }

  listByDriverId(driverId: string) {
    return prisma.review.findMany({
      where: { driverId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getDriverAverageRating(driverId: string) {
    const aggregate = await prisma.review.aggregate({
      where: { driverId },
      _avg: { rating: true },
      _count: { rating: true },
    });
    return {
      averageRating: aggregate._avg.rating ?? 0,
      totalReviews: aggregate._count.rating,
    };
  }
}
