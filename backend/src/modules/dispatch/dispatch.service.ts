import { SocketService } from "../../websocket/socket";
import { LocationService } from "../location/location.service";
import { MAP_CONSTANTS } from "../location/map.constants";
import { DispatchRepository } from "./dispatch.repository";
import { DispatchScheduler } from "./dispatch.scheduler";
import { DispatchState } from "./dispatch.state";
import { DispatchLock } from "./dispatch.lock";
import { DISPATCH_CONSTANTS } from "./dispatch.constants";
import { prisma } from "../../config/prisma";
import { logger } from "../../config/logger";
import { TariffEngineService } from "../tariff/tariff.service";
import {
  DispatchCandidate,
  DispatchRequest,
  DispatchResult,
} from "./dispatch.types";

export class DispatchService {
  private repository = new DispatchRepository();
  private locationService = new LocationService();
  private tariffEngine = new TariffEngineService();

  /*
  |--------------------------------------------------------------------------
  | Start Dispatch
  |--------------------------------------------------------------------------
  */
  async dispatch(request: DispatchRequest): Promise<DispatchResult> {
    const orderId = request.order.id;

    const locked = await DispatchLock.acquire(orderId);
    if (!locked) {
      const current = await DispatchState.current(orderId);
      return {
        orderId,
        totalDrivers: 0,
        currentDriverId: current?.driverId ?? undefined,
        status: "ALREADY_DISPATCHING",
        candidates: [],
      };
    }

    try {
      logger.info(`[DISPATCH] Mulai dispatch order ${orderId} (serviceType=${request.order.serviceType})`);

      const nearestDrivers = await this.locationService.nearestDrivers(
        {
          latitude: request.order.pickupLat,
          longitude: request.order.pickupLng,
        },
        DISPATCH_CONSTANTS.MAX_CANDIDATES
      );

      logger.info(`[DISPATCH] order ${orderId}: ${nearestDrivers.length} driver online terdekat ditemukan`);

      const availableDrivers = await this.repository.getAvailableDrivers();
      logger.info(`[DISPATCH] order ${orderId}: ${availableDrivers.length} driver lolos getAvailableDrivers`);

      const availableMap = new Map(
        availableDrivers.map((driver: any) => [driver.id, driver])
      );

      // ============================================================
      // 🔒 STEP 3: Filter ELIGIBILITY (PAKAI SERVICE SAMA)
      // ============================================================
      const { DriverEligibilityService } = await import('../driver/services/driver-eligibility.service');
      const eligibilityService = new DriverEligibilityService();

      const eligibleDrivers: any[] = [];
      for (const driver of availableDrivers) {
        const eligibility = await eligibilityService.check({
          driverId: driver.id,
          order: {
            serviceType: request.order.serviceType,
            pickupLat: request.order.pickupLat,
            pickupLng: request.order.pickupLng,
          },
          options: {
            minimumDeposit: await this.tariffEngine.getMinimumDriverDeposit(),
            maxDistanceKm: 5,
            maxDailyOrders: 20,
            checkLocationFreshness: true,
            locationFreshnessMinutes: 5,
          },
        });

        if (eligibility.isEligible) {
          eligibleDrivers.push({
            ...driver,
            eligibilityScore: eligibility.score,
            reasons: eligibility.reasons,
          });
        }
      }

      logger.info(`[DISPATCH] order ${orderId}: ${eligibleDrivers.length} driver lolos eligibility check`);

      const eligibleMap = new Map(
        eligibleDrivers.map((d: any) => [d.id, d])
      );

      const candidates: DispatchCandidate[] = nearestDrivers
        .filter((driver: any) => eligibleMap.has(driver.driverId))
        .filter((driver: any) => {
          if (request.order.serviceType === "SEND" || request.order.serviceType === "MART") {
            return true;
          }
          const profile = eligibleMap.get(driver.driverId);
          return profile && (profile as any).serviceType === request.order.serviceType;
        })
        .map((driver: any) => {
          const profile = eligibleMap.get(driver.driverId)!;
          return {
            driverId: profile.id,
            userId: profile.userId,
            latitude: Number(profile.latitude),
            longitude: Number(profile.longitude),
            distanceMeters: driver.distanceMeters,
            etaMinutes: Math.ceil(
              driver.distanceMeters /
              (MAP_CONSTANTS.BIKE_SPEED_KMH * 1000 / 60)
            ),
            autoAcceptEnabled: Boolean((profile as any).autoAcceptEnabled),
          };
        });

      logger.info(`[DISPATCH] order ${orderId}: ${candidates.length} kandidat FINAL`);

      await DispatchState.create(
        orderId,
        candidates.map(driver => driver.driverId)
      );

      await this.offerNextDriver(request, candidates);

      const current = await DispatchState.current(orderId);

      return {
        orderId,
        totalDrivers: candidates.length,
        currentDriverId: current?.driverId ?? undefined,
        status: candidates.length > 0 ? "DISPATCHING" : "NO_DRIVER",
        candidates,
      };

    } finally {
      await DispatchLock.release(orderId);
    }
  }

  /*
  |--------------------------------------------------------------------------
  | Sequential Driver Offer
  |--------------------------------------------------------------------------
  */
  private async offerNextDriver(
    request: DispatchRequest,
    candidates: DispatchCandidate[]
  ) {
    const orderId = request.order.id;
    const current = await DispatchState.current(orderId);

    if (!current) {
      const customerProfile = await prisma.customerProfile.findUnique({
        where: { id: request.order.customerId },
        select: { userId: true },
      });
      if (customerProfile) {
        SocketService.emitToUser(
          customerProfile.userId,
          DISPATCH_CONSTANTS.ORDER_EXPIRED_EVENT,
          { orderId }
        );
      }
      SocketService.emitToAdmins(DISPATCH_CONSTANTS.ORDER_EXPIRED_EVENT, { orderId });
      return;
    }

    const driver = candidates.find(
      candidate => candidate.driverId === current.driverId
    );

    if (!driver) {
      await DispatchState.next(orderId);
      return this.offerNextDriver(request, candidates);
    }

    if (driver.autoAcceptEnabled) {
      logger.info(`[DISPATCH] order ${orderId}: driver ${driver.driverId} autoAcceptEnabled=true, mencoba auto-accept...`);

      try {
        await this.acceptOffer(orderId, driver.driverId);
        logger.info(`[DISPATCH] order ${orderId}: AUTO-ACCEPT BERHASIL oleh driver ${driver.driverId}`);
        return;
      } catch (err: any) {
        logger.error(`[DISPATCH] order ${orderId}: auto-accept GAGAL: ${err?.message || err} -- lanjut ke kandidat berikutnya.`);
        await DispatchState.next(orderId);
        return this.offerNextDriver(request, candidates);
      }
    }

    SocketService.emitToUser(
      driver.userId,
      DISPATCH_CONSTANTS.NEW_ORDER_EVENT,
      {
        orderId,
        serviceType: request.order.serviceType,
        pickupAddress: request.order.pickupAddress,
        dropoffAddress: request.order.dropoffAddress,
        pickupLat: request.order.pickupLat,
        pickupLng: request.order.pickupLng,
        dropoffLat: request.order.dropoffLat,
        dropoffLng: request.order.dropoffLng,
        distanceKm: request.order.distanceKm,
        price: request.order.price,
        etaMinutes: driver.etaMinutes,
        distanceMeters: driver.distanceMeters,
      }
    );

    await DispatchScheduler.start(
      orderId,
      DISPATCH_CONSTANTS.OFFER_TIMEOUT_SECONDS,
      async () => {
        SocketService.emitToUser(driver.userId, DISPATCH_CONSTANTS.ORDER_TIMEOUT_EVENT, { orderId });

        const hasAccepted = await DispatchState.hasAccepted(orderId);
        if (hasAccepted) {
          return;
        }

        await DispatchState.next(orderId);
        await this.offerNextDriver(request, candidates);
      }
    );
  }

  /*
  |--------------------------------------------------------------------------
  | Accept Driver Offer
  |--------------------------------------------------------------------------
  */
  async acceptOffer(orderId: string, driverId: string) {
    const current = await DispatchState.current(orderId);
    if (!current) {
      throw new Error("Dispatch session tidak ditemukan");
    }

    if (current.driverId !== driverId) {
      throw new Error("Driver bukan penerima offer aktif");
    }

    const locked = await DispatchLock.acquire(orderId);
    if (!locked) {
      throw new Error("Order sedang diproses");
    }

    try {
      await DispatchState.accept(orderId, driverId);
      await DispatchScheduler.cancel(orderId);

      const order = await this.repository.assignDriver(orderId, driverId);
      await DispatchState.clear(orderId);

      try {
        const driverProfile = await this.repository.getDriver(driverId);
        SocketService.emitToOrder(orderId, "order_status_changed", {
          orderId,
          status: (order as any).status,
          driverId,
        });
        SocketService.emitToUser((order as any).customer.userId, "order_accepted", {
          orderId,
          driverId,
          driver: {
            fullName: (driverProfile as any)?.user?.fullName,
            vehicleModel: (driverProfile as any)?.vehicleModel,
            vehiclePlate: (driverProfile as any)?.vehiclePlate,
          },
        });
        if (driverProfile?.userId) {
          SocketService.emitToUser(driverProfile.userId, DISPATCH_CONSTANTS.ORDER_ACCEPTED_EVENT, { orderId });
        }
        SocketService.emitToDriversPool("order_taken", { orderId });
        SocketService.emitToAdmins("order_accepted", { orderId });
      } catch {
        // Socket.IO belum siap
      }

      return order;

    } finally {
      await DispatchLock.release(orderId);
    }
  }

  /*
  |--------------------------------------------------------------------------
  | Dispatch Status
  |--------------------------------------------------------------------------
  */
  async getStatus(orderId: string) {
    const current = await DispatchState.current(orderId);
    return {
      orderId,
      currentDriverId: current?.driverId ?? undefined,
      hasActiveSession: await DispatchState.exists(orderId),
    };
  }
}