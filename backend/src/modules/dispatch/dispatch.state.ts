// modules/dispatch/dispatch.state.ts
import { DispatchRedis } from './dispatch.redis';
import { logger } from '../../config/logger';

export class DispatchState {
  static async create(orderId: string, driverIds: string[]): Promise<void> {
    await DispatchRedis.setDispatchState(orderId, driverIds);
    await DispatchRedis.setCurrentDriver(orderId, driverIds[0]);
    logger.info(`[DISPATCH] Session created for ${orderId} with ${driverIds.length} drivers`);
  }

  static async current(orderId: string): Promise<{ driverId: string; index: number } | null> {
    const state = await DispatchRedis.getDispatchState(orderId);
    if (!state) return null;
    const driverId = await DispatchRedis.getCurrentDriver(orderId);
    if (!driverId) return null;
    return { driverId, index: state.currentIndex || 0 };
  }

  static async next(orderId: string): Promise<string | null> {
    const state = await DispatchRedis.getDispatchState(orderId);
    if (!state) return null;

    const nextIndex = (state.currentIndex || 0) + 1;
    if (nextIndex >= state.driverIds.length) {
      await DispatchRedis.clearDispatchState(orderId);
      await DispatchRedis.clearCurrentDriver(orderId);
      return null;
    }

    const nextDriverId = state.driverIds[nextIndex];
    await DispatchRedis.updateDispatchState(orderId, { currentIndex: nextIndex });
    await DispatchRedis.setCurrentDriver(orderId, nextDriverId);
    return nextDriverId;
  }

  static async accept(orderId: string, driverId: string): Promise<void> {
    const current = await this.current(orderId);
    if (!current || current.driverId !== driverId) {
      throw new Error('Driver is not the current offer recipient');
    }
    await DispatchRedis.updateDispatchState(orderId, { status: 'ACCEPTED' });
    await DispatchRedis.clearCurrentDriver(orderId);
    await DispatchRedis.setDriverBusy(driverId, orderId);
  }

  static async hasAccepted(orderId: string): Promise<boolean> {
    const state = await DispatchRedis.getDispatchState(orderId);
    return state?.status === 'ACCEPTED';
  }

  static async exists(orderId: string): Promise<boolean> {
    return (await DispatchRedis.getDispatchState(orderId)) !== null;
  }

  static async clear(orderId: string): Promise<void> {
    await DispatchRedis.clearDispatchState(orderId);
    await DispatchRedis.clearCurrentDriver(orderId);
  }

  static async recoverPending(): Promise<void> {
    const orderIds = await DispatchRedis.recoverPendingDispatches();
    if (orderIds.length > 0) {
      logger.warn(`[DISPATCH] Recovering ${orderIds.length} pending dispatch sessions...`);
    }
  }
}