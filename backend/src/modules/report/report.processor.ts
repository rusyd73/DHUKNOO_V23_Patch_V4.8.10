import { Worker, Job } from 'bullmq';
import { RedisService } from '../../config/redis';
import { prisma } from '../../config/prisma';
import { SocketService } from '../../websocket/socket';
import { logger } from '../../config/logger';
import { ExcelGenerator } from './excel.generator';
import { PdfGenerator } from './pdf.generator';
import { ReportJobPayload } from './report.types';

const ALLOWED_REPORTS = new Set([
  'orders',
  'payments',
  'wallet',
  'customers',
  'drivers',
  'merchant',
  'promo',
]);

let reportWorker: Worker | undefined;

const redisConnection =
  (RedisService as any).client ??
  (RedisService as any).redis ??
  null;

if (!redisConnection) {
  logger.warn(
    '[ReportWorker] Redis unavailable. Report background worker disabled.'
  );
} else {
  reportWorker = new Worker(
    'report-generation-queue',
    async (job: Job<ReportJobPayload>) => {
      const { userId, reportType, format, filters } = job.data;

      const targetRoom = `user_${userId}`;

      logger.info(
        `[ReportWorker] ${reportType} requested by ${userId}`
      );

      await job.updateProgress(5);

      if (!ALLOWED_REPORTS.has(reportType)) {
        throw new Error(
          `Unsupported report type: ${reportType}`
        );
      }

      const where: any = {};

      if (filters?.startDate && filters?.endDate) {
        where.createdAt = {
          gte: new Date(filters.startDate),
          lte: new Date(filters.endDate),
        };
      }

      if (filters?.status)
        where.status = filters.status;

      if (filters?.merchantId)
        where.merchantId = filters.merchantId;

      if (filters?.driverId)
        where.driverId = filters.driverId;

      if (filters?.customerId)
        where.customerId = filters.customerId;

      let rawData: any[] = [];

      const maxRows = 10000;

      switch (reportType) {
        case 'orders':
          rawData = await prisma.order.findMany({
            where,
            include: {
              customer: true,
            } as any,
            orderBy: {
              createdAt: 'desc',
            },
            take: maxRows,
          });
          break;

        default: {
          const modelName = reportType.replace(/s$/, '');

          if ((prisma as any)[modelName]) {
            rawData = await (prisma as any)[modelName].findMany({
              where,
              take: maxRows,
            });
          }
        }
      }

      await job.updateProgress(40);

      const fileBuffer =
        format === 'excel'
          ? await ExcelGenerator.generateOrderReport(rawData)
          : await PdfGenerator.generateOrderReport(rawData);

      // sementara belum dipakai sebelum storage selesai
      void fileBuffer;

      await job.updateProgress(70);

      const extension =
        format === 'excel' ? 'xlsx' : 'pdf';

      const fileName = `reports/${reportType}/${userId}-${Date.now()}.${extension}`;

      // TODO:
      // ganti dengan hasil upload storage.upload()
      const downloadUrl = `https://obamaride.id/${fileName}`;

      await job.updateProgress(90);

      const socket = (SocketService as any).io;

      if (socket) {
        socket.to(targetRoom).emit('report_ready', {
          jobId: job.id,
          reportType,
          format,
          downloadUrl,
        });
      }

      await job.updateProgress(100);

      logger.info(
        `[ReportWorker] ${reportType} finished for ${userId}`
      );

      return {
        success: true,
        downloadUrl,
      };
    },
    {
      connection: redisConnection,
      concurrency: 2,
    }
  );

  reportWorker.on('completed', (job) => {
    logger.info(
      `[ReportWorker] Job ${job.id} completed`
    );
  });

  reportWorker.on('failed', (job, err) => {
    logger.error(
      `[ReportWorker] Job ${job?.id} failed: ${err.message}`
    );
  });

  reportWorker.on('error', (err) => {
    logger.error(
      `[ReportWorker] ${err.message}`
    );
  });
}

export { reportWorker };