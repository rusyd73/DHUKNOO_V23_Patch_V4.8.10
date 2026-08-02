import { Request, Response } from 'express';
import { prisma } from './prisma';
import { RedisService } from './redis';
import { logger } from './logger';

export class HealthCheckController {
  public static async check(req: Request, res: Response) {
    const healthInfo: any = {
      status: 'UP',
      timestamp: new Date().toISOString(),
      services: {
        database: { status: 'DOWN', details: '' },
        redis: { status: 'DOWN', details: '' },
        system: {
          uptime: process.uptime(),
          memoryUsage: process.memoryUsage(),
          nodeVersion: process.version,
        }
      }
    };

    let isHealthy = true;

    // Check Database (Prisma)
    try {
      await prisma.$queryRaw`SELECT 1`;
      healthInfo.services.database.status = 'UP';
      healthInfo.services.database.details = 'PostgreSQL is fully connected and active.';
    } catch (err: any) {
      isHealthy = false;
      healthInfo.services.database.status = 'DOWN';
      healthInfo.services.database.details = err.message;
    }

    // Check Redis
    try {
      const client = RedisService.getClient();
      if (client && client.status === 'ready') {
        healthInfo.services.redis.status = 'UP';
        healthInfo.services.redis.details = 'Redis caching server is active and responding.';
      } else {
        healthInfo.services.redis.status = 'DEGRADED';
        healthInfo.services.redis.details = 'Redis is running in in-memory fallback mode.';
      }
    } catch (err: any) {
      healthInfo.services.redis.status = 'DOWN';
      healthInfo.services.redis.details = err.message;
    }

    if (!isHealthy) {
      healthInfo.status = 'DOWN';
      logger.error('Health Check failed: one or more critical services are offline.', healthInfo);
      return res.status(503).json(healthInfo);
    }

    return res.status(200).json(healthInfo);
  }
}
