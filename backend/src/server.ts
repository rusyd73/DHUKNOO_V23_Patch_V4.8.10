import { app, httpServer } from './app';
import { ENV } from './config/env';
import { logger } from './config/logger';
import { prisma } from './config/prisma';

httpServer.listen(ENV.PORT, '0.0.0.0', () => {
  logger.info(
    `🚀 DHUKNOO backend (arsitektur modern: app.ts -> modules -> Prisma) berjalan di port ${ENV.PORT} [${ENV.NODE_ENV}]`
  );
});

// ============================================================
async function shutdown(signal: string) {
  logger.info(`[SERVER] Menerima ${signal}, memulai graceful shutdown...`);
  httpServer.close(async () => {
    try {
      await prisma.$disconnect();
    } catch (err: any) {
      logger.error('[SERVER] Error saat disconnect Prisma: %s', err?.message || err);
    }
    logger.info('[SERVER] Shutdown selesai.');
    process.exit(0);
  });

  // Force-exit kalau graceful shutdown macet lebih dari 10 detik
  setTimeout(() => {
    logger.error('[SERVER] Graceful shutdown timeout -- force exit.');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export { app };
