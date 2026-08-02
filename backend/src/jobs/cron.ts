import { logger } from '../config/logger';

export class BackgroundJobs {
  public static init() {
    logger.info('Initializing background cron jobs...');
    
    // Simulate a simple 10 minute interval runner
    setInterval(() => {
      logger.info('Running cron job: Auditing driver online statuses...');
    }, 10 * 60 * 1000).unref(); // unref so it won't block server shutdown
  }
}
