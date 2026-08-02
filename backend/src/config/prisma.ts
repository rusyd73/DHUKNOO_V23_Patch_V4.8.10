import { PrismaClient } from '@prisma/client';
import { logger } from './logger';

export const prisma = new PrismaClient();

// Test the connection
prisma.$connect()
  .then(() => {
    logger.info('Database (Prisma) connection established successfully.');
  })
  .catch((err) => {
    logger.error('Failed to connect to the database via Prisma: %s', err.message || err);
  });
