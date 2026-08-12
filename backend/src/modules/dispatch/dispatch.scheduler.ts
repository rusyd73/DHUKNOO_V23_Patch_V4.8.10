// modules/dispatch/dispatch.scheduler.ts
import { DispatchRedis } from './dispatch.redis';
import { logger } from '../../config/logger';

export class DispatchScheduler {
  private static timeouts: Map<string, NodeJS.Timeout> = new Map();

  static async start(orderId: string, delaySeconds: number, callback: () => Promise<void>): Promise<void> {
    await DispatchRedis.scheduleTimeout(orderId, delaySeconds);

    if (this.timeouts.has(orderId)) {
      clearTimeout(this.timeouts.get(orderId)!);
    }

    const timeout = setTimeout(async () => {
      const isPending = await DispatchRedis.checkTimeout(orderId);
      if (!isPending) return;

      await callback();
      await DispatchRedis.cancelTimeout(orderId);
      this.timeouts.delete(orderId);
    }, delaySeconds * 1000);

    this.timeouts.set(orderId, timeout);
  }

  static async cancel(orderId: string): Promise<void> {
    if (this.timeouts.has(orderId)) {
      clearTimeout(this.timeouts.get(orderId)!);
      this.timeouts.delete(orderId);
    }
    await DispatchRedis.cancelTimeout(orderId);
  }
}