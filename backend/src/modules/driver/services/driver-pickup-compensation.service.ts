import { ServiceType } from '@prisma/client';
import { prisma } from '../../../config/prisma';
import { logger } from '../../../config/logger';
import { TariffRepository } from '../../tariff/tariff.repository';
import { calculateSmartPickupCompensation, type PickupDispatchClass } from '../../tariff/monetization.policy';

export interface DriverPickupCompensationSnapshot {
  customerBillableDistanceKm?: number;
  customerFareAtAcceptance?: number;
  customerFareOrigin?: 'CUSTOMER_PUBLISHED_PICKUP';
  driverPickupDistanceKm: number;
  // Alias lama dipertahankan agar audit/report yang sudah membaca nama ini tetap kompatibel.
  driverAcceptanceDistanceKm: number;
  driverPickupRatePerKm: number;
  driverPickupCompensation: number;
  driverPickupCompensationCommissionable: false;
  driverPickupCompensationRateSource: string;
  driverPickupCompensationPolicy: 'SMART_PICKUP_V1';
  driverPickupDispatchClass: PickupDispatchClass;
  driverPickupSnapshotAt: string;
}

/**
 * FIX7 — Driver -> pickup distance-based compensation.
 *
 * KONTRAK FINANSIAL:
 * - Order.distanceKm / Order.price milik customer TIDAK disentuh.
 * - Jarak dihitung dari posisi driver tepat saat menerima order -> titik pickup.
 * - Hasil di-snapshot di PricingHistory.breakdown supaya settlement di kemudian
 *   hari tidak bergantung pada lokasi driver yang sudah berubah.
 * - Kompensasi dibayar sebagai earning TAMBAHAN dari platform dan TIDAK dikenai
 *   komisi driver.
 */
export class DriverPickupCompensationService {
  private tariffRepo = new TariffRepository();
  private readonly DEFAULT_RATE_PER_KM = 1000;

  private toRad(value: number) {
    return (value * Math.PI) / 180;
  }

  private haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
    const R = 6371;
    const dLat = this.toRad(lat2 - lat1);
    const dLng = this.toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2
      + Math.cos(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
  }

  /**
   * Prioritas konfigurasi rate per km:
   * 1) DRIVER_PICKUP_COMPENSATION_PER_KM_<SERVICE>
   * 2) DRIVER_PICKUP_COMPENSATION_PER_KM
   * 3) DRIVER_PICKUP_RATE_PER_KM (legacy key dari implementasi awal)
   * 4) PricingRule.pickupFee untuk service tsb (backward-compatible fallback)
   * 5) Rp1.000/km default darurat.
   */
  async resolveRatePerKm(serviceType: ServiceType): Promise<{ rate: number; source: string }> {
    const keys = [
      `DRIVER_PICKUP_COMPENSATION_PER_KM_${serviceType}`,
      'DRIVER_PICKUP_COMPENSATION_PER_KM',
      'DRIVER_PICKUP_RATE_PER_KM',
    ];

    for (const key of keys) {
      const config = await this.tariffRepo.getConfig(key);
      if (!config) continue;
      const parsed = Number(config.value);
      if (Number.isFinite(parsed) && parsed >= 0) return { rate: parsed, source: key };
    }

    const fallbackRule = await this.tariffRepo.findFallbackRule(serviceType);
    const ruleRate = Number(fallbackRule?.pickupFee ?? NaN);
    if (Number.isFinite(ruleRate) && ruleRate >= 0) {
      return { rate: ruleRate, source: 'PRICING_RULE_PICKUP_FEE_FALLBACK' };
    }

    return { rate: this.DEFAULT_RATE_PER_KM, source: 'DEFAULT_1000_PER_KM' };
  }

  async calculate(input: {
    serviceType: ServiceType;
    driverLat: number | null | undefined;
    driverLng: number | null | undefined;
    pickupLat: number;
    pickupLng: number;
    customerBillableDistanceKm?: number;
    customerFareAtAcceptance?: number;
  }): Promise<DriverPickupCompensationSnapshot> {
    const driverLat = Number(input.driverLat);
    const driverLng = Number(input.driverLng);
    const pickupLat = Number(input.pickupLat);
    const pickupLng = Number(input.pickupLng);
    const hasDriverCoords = input.driverLat !== null && input.driverLat !== undefined
      && input.driverLng !== null && input.driverLng !== undefined
      && [driverLat, driverLng, pickupLat, pickupLng].every(Number.isFinite);

    // Rate legacy tetap di-resolve untuk kompatibilitas konfigurasi/audit,
    // tetapi nominal V1 tidak lagi linear per-km.
    const { source } = await this.resolveRatePerKm(input.serviceType);
    const rawDistance = hasDriverCoords
      ? this.haversineKm(driverLat, driverLng, pickupLat, pickupLng)
      : 0;
    const distanceKm = Math.round(Math.max(0, rawDistance) * 1000) / 1000;
    const smartPickup = calculateSmartPickupCompensation(distanceKm);
    const compensation = smartPickup.compensation;

    return {
      ...(typeof input.customerBillableDistanceKm === 'number'
        ? { customerBillableDistanceKm: input.customerBillableDistanceKm }
        : {}),
      ...(typeof input.customerFareAtAcceptance === 'number'
        ? { customerFareAtAcceptance: input.customerFareAtAcceptance }
        : {}),
      customerFareOrigin: 'CUSTOMER_PUBLISHED_PICKUP',
      driverPickupDistanceKm: distanceKm,
      driverAcceptanceDistanceKm: distanceKm,
      driverPickupRatePerKm: smartPickup.effectiveRatePerKm,
      driverPickupCompensation: compensation,
      driverPickupCompensationCommissionable: false,
      driverPickupCompensationRateSource: `${source}:SMART_PICKUP_V1`,
      driverPickupCompensationPolicy: 'SMART_PICKUP_V1',
      driverPickupDispatchClass: smartPickup.dispatchClass,
      driverPickupSnapshotAt: new Date().toISOString(),
    };
  }

  /**
   * Jalur dispatch/manual yang sudah melakukan claim sendiri dapat memakai
   * helper idempotent ini. Untuk jalur yang membutuhkan atomic claim+snapshot,
   * panggil calculate() lalu simpan breakdown di transaction claim tersebut.
   */
  async snapshotAtAcceptance(orderId: string, driverId: string) {
    const [order, driver, pricingHistory] = await Promise.all([
      prisma.order.findUnique({
        where: { id: orderId },
        select: {
          id: true,
          serviceType: true,
          pickupLat: true,
          pickupLng: true,
          distanceKm: true,
          price: true,
          discount: true,
        },
      }),
      prisma.driverProfile.findUnique({
        where: { id: driverId },
        select: { id: true, latitude: true, longitude: true },
      }),
      prisma.pricingHistory.findUnique({ where: { orderId } }),
    ]);

    if (!order || !driver) return null;

    const snapshot = await this.calculate({
      serviceType: order.serviceType,
      driverLat: driver.latitude,
      driverLng: driver.longitude,
      pickupLat: order.pickupLat,
      pickupLng: order.pickupLng,
      customerBillableDistanceKm: Number(order.distanceKm),
      customerFareAtAcceptance: Number(order.price) - Number(order.discount),
    });

    const currentBreakdown = pricingHistory?.breakdown && typeof pricingHistory.breakdown === 'object'
      ? (pricingHistory.breakdown as Record<string, unknown>)
      : {};

    if (pricingHistory) {
      await prisma.pricingHistory.update({
        where: { orderId },
        data: { breakdown: { ...currentBreakdown, ...snapshot } as any },
      });
    } else {
      await prisma.pricingHistory.create({
        data: { orderId, tariffVersionId: null, breakdown: snapshot as any },
      });
    }

    logger.info(
      `[PICKUP_COMP] Order ${orderId}: customerDistance=${Number(order.distanceKm).toFixed(3)}km tetap; `
      + `driver->pickup=${snapshot.driverPickupDistanceKm.toFixed(3)}km => Rp${snapshot.driverPickupCompensation} `
      + `[${snapshot.driverPickupDispatchClass}, SMART_PICKUP_V1] (non-commissionable).`,
    );

    return snapshot;
  }
}
