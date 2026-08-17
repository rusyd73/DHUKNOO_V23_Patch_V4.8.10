import { Queue, Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { RedisService } from '../config/redis';
import { logger } from '../config/logger';
import { prisma } from '../config/prisma';

export class QueueService {
  private static notificationQueue: Queue | null = null;
  private static worker: Worker | null = null;
  private static bullmqConnection: Redis | null = null;

  private static createBullMQConnection(): Redis | null {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      logger.warn('REDIS_URL tidak tersedia. BullMQ background processor dinonaktifkan.');
      return null;
    }

    return new Redis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
    });
  }

  public static init() {
    const redisClient = RedisService.getClient();
    if (!redisClient || !RedisService.isReady()) {
      logger.info('Redis is not connected or mocked. BullMQ background processor is disabled.');
      return;
    }

    try {
      logger.info('Initializing BullMQ Notification Queue & Workers...');

      const connection = this.createBullMQConnection();
      if (!connection) return;
      this.bullmqConnection = connection;

      this.notificationQueue = new Queue('NotificationQueue', {
        connection: connection as any,
      });

      this.worker = new Worker(
        'NotificationQueue',
        async (job: Job) => {
          logger.info(`BullMQ processing job [ID: ${job.id}] [Name: ${job.name}]`);

          switch (job.name) {
            case 'SEND_PUSH_NOTIFICATION': {
              const { userId, title, body } = job.data;
              logger.info(`Sending push notification to user ${userId}: "${title}" - ${body}`);

              try {
                await prisma.activityLog.create({
                  data: {
                    userId,
                    action: 'NOTIFICATION_SENT',
                    details: `Push sent: "${title}" - ${body}`,
                  },
                });
              } catch (err: any) {
                logger.error(`Failed to record audit log for push notification: ${err.message}`);
              }
              break;
            }
            default:
              logger.warn(`Unknown job name in queue: ${job.name}`);
          }
        },
        {
          connection: connection as any,
          concurrency: 5,
        }
      );

      this.worker.on('completed', (job) => {
        logger.info(`BullMQ Job ${job.id} completed successfully.`);
      });

      this.worker.on('failed', (job, err) => {
        logger.error(`BullMQ Job ${job?.id} failed with error: ${err.message}`);
      });

      this.worker.on('error', (err) => {
        logger.error(`BullMQ Worker error: ${err.message}`);
      });

      logger.info('BullMQ service successfully registered and listening.');
    } catch (err) {
      logger.error('Failed to initialize BullMQ service: %s', (err as Error).message || err);
    }
  }

  public static async addNotificationJob(userId: string, title: string, body: string) {
    if (this.notificationQueue) {
      try {
        await this.notificationQueue.add('SEND_PUSH_NOTIFICATION', { userId, title, body });
        logger.info(`Queued background push notification for user ${userId}`);
      } catch (err: any) {
        logger.error(`Failed to enqueue BullMQ job: ${err.message}`);
      }
    } else {
      logger.info(`[Fallback] Directly dispatching notification to user ${userId}: "${title}"`);
      try {
        await prisma.activityLog.create({
          data: {
            userId,
            action: 'NOTIFICATION_SENT_FALLBACK',
            details: `[Direct/Fallback] Push: "${title}"`,
          },
        });
      } catch (e: any) {
        logger.error(`Failed to record fallback log: ${e.message}`);
      }
    }
  }
}
