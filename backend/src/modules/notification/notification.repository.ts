import { prisma } from '../../config/prisma';

export class NotificationRepository {
  listForUser(userId: string, limit = 30, offset = 0) {
    return prisma.activityLog.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });
  }
}
