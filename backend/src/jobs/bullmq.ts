import { Queue, Worker, Job } from 'bullmq';
import { RedisService } from '../config/redis';
import { logger } from '../config/logger';
import { prisma } from '../config/prisma';

export class QueueService {
  private static notificationQueue: Queue | null = null;
  private static worker: Worker | null = null;

  public static init() {
    const redisClient = RedisService.getClient();
    if (!redisClient) {
      logger.info('Redis is not connected or mocked. BullMQ background processor is disabled.');
      return;
    }

    try {
      logger.info('Initializing BullMQ Notification Queue & Workers...');
      
      // Initialize Queue
      this.notificationQueue = new Queue('NotificationQueue', {
        // Cast: bullmq bundles its own copy of `ioredis`, which TypeScript treats
        // as a structurally different type from our top-level `ioredis` client.
        // The instance is fully compatible at runtime.
        connection: redisClient as any,
      });

      // Initialize Worker
      this.worker = new Worker(
        'NotificationQueue',
        async (job: Job) => {
          logger.info(`BullMQ processing job [ID: ${job.id}] [Name: ${job.name}]`);
          
          switch (job.name) {
            case 'SEND_PUSH_NOTIFICATION': {
              const { userId, title, body } = job.data;
              logger.info(`Sending push notification to user ${userId}: "${title}" - ${body}`);
              
              // Simulate push notification dispatch
              // Record activity log in database as an audit log trail
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
          connection: redisClient as any,
          concurrency: 5,
        }
      );

      this.worker.on('completed', (job) => {
        logger.info(`BullMQ Job ${job.id} completed successfully.`);
      });

      this.worker.on('failed', (job, err) => {
        logger.error(`BullMQ Job ${job?.id} failed with error: ${err.message}`);
      });

      logger.info('BullMQ service successfully registered and listening.');
    } catch (err) {
      logger.error('Failed to initialize BullMQ service: %s', (err as Error).message || err);
    }
  }

  /**
   * Add a background push notification job to the queue
   */
  public static async addNotificationJob(userId: string, title: string, body: string) {
    if (this.notificationQueue) {
      try {
        await this.notificationQueue.add('SEND_PUSH_NOTIFICATION', { userId, title, body });
        logger.info(`Queued background push notification for user ${userId}`);
      } catch (err: any) {
        logger.error(`Failed to enqueue BullMQ job: ${err.message}`);
      }
    } else {
      // In-memory fallback if queue is inactive
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
