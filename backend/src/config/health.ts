import { Request, Response } from 'express';
import { prisma } from './prisma';
import { RedisService } from './redis';
import { logger } from './logger';
import { ENV } from './env';

// ============================================================
// 🔒 PUBLIC HEALTH - MINIMAL
// ============================================================
export class HealthCheckController {
  public static async check(req: Request, res: Response) {
    try {
      // Cek database
      let dbStatus = 'UP';
      try {
        await prisma.$queryRaw`SELECT 1`;
      } catch (err) {
        dbStatus = 'DOWN';
        logger.error('[Health] Database check failed:', err);
      }

      // Cek Redis (jika dikonfigurasi)
      let redisStatus = 'unknown';
      if (ENV.REDIS_URL) {
        try {
          const client = RedisService.getClient();
          if (client && RedisService.isReady()) {
            await client.ping();
            redisStatus = 'UP';
          } else {
            redisStatus = 'DOWN';
          }
        } catch (err) {
          redisStatus = 'DOWN';
          logger.error('[Health] Redis check failed:', err);
        }
      }

      // ✅ PUBLIC: HANYA status minimal
      const isHealthy = dbStatus === 'UP';
      const statusCode = isHealthy ? 200 : 503;

      return res.status(statusCode).json({
        status: isHealthy ? 'UP' : 'DOWN',
        timestamp: new Date().toISOString(),
        services: {
          database: { status: dbStatus },
          redis: { status: redisStatus },
          system: { uptime: process.uptime() },
        },
      });
    } catch (error) {
      logger.error('[Health] Health check failed:', error);
      return res.status(503).json({
        status: 'DOWN',
        timestamp: new Date().toISOString(),
        error: 'Service unavailable',
      });
    }
  }

  // ============================================================
  // 🔒 INTERNAL HEALTH - DETAIL (untuk monitoring internal)
  // ============================================================
  public static async internal(req: Request, res: Response) {
    try {
      // Database health
      let dbStatus = 'UP';
      let dbLatency = 0;
      try {
        const start = Date.now();
        await prisma.$queryRaw`SELECT 1`;
        dbLatency = Date.now() - start;
      } catch (err) {
        dbStatus = 'DOWN';
        logger.error('[Health Internal] Database check failed:', err);
      }

      // Redis health (jika dikonfigurasi)
      let redisStatus = 'unknown';
      let redisLatency = 0;
      if (ENV.REDIS_URL) {
        try {
          const start = Date.now();
          const client = RedisService.getClient();
          if (client && RedisService.isReady()) {
            await client.ping();
            redisLatency = Date.now() - start;
            redisStatus = 'UP';
          } else {
            redisStatus = 'DOWN';
          }
        } catch (err) {
          redisStatus = 'DOWN';
          logger.error('[Health Internal] Redis check failed:', err);
        }
      }

      const isHealthy = dbStatus === 'UP';

      // ✅ INTERNAL: detail lengkap
      return res.status(isHealthy ? 200 : 503).json({
        status: isHealthy ? 'UP' : 'DOWN',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        nodeVersion: process.version,
        memoryUsage: {
          rss: Math.round(process.memoryUsage().rss / 1024 / 1024),
          heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
          heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
          external: Math.round(process.memoryUsage().external / 1024 / 1024),
        },
        services: {
          database: {
            status: dbStatus,
            latency: dbLatency,
          },
          redis: {
            status: redisStatus,
            latency: redisLatency,
          },
        },
        environment: ENV.NODE_ENV,
        pid: process.pid,
      });
    } catch (error) {
      logger.error('[Health Internal] Internal health check failed:', error);
      return res.status(500).json({
        status: 'DOWN',
        timestamp: new Date().toISOString(),
        error: 'Internal health check failed',
      });
    }
  }
}