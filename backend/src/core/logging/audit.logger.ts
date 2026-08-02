import { prisma } from '../../config/prisma';
import { Prisma } from '@prisma/client';
import { logger } from '../../config/logger';

export class AuditLogger {
  /**
   * Log a security or business event into the database
   */
  public static async log(
  userId: string,
  action: string,
  details?: string,
  db: Prisma.TransactionClient | typeof prisma = prisma
) {
  await db.activityLog.create({
    data: {
      userId,
      action,
      details: details ?? null,
    },
  });

  logger.info(
    `Audit Log recorded for User [ID: ${userId}] - Action: ${action}`
  );
  }
}