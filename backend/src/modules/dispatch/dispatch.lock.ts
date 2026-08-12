// modules/dispatch/dispatch.lock.ts
import { DispatchRedis } from './dispatch.redis';

export class DispatchLock {
  static async acquire(orderId: string): Promise<boolean> {
    return DispatchRedis.acquireLock(orderId);
  }

  static async release(orderId: string): Promise<void> {
    await DispatchRedis.releaseLock(orderId);
  }
}