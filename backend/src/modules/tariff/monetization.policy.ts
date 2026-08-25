import { ServiceType } from '@prisma/client';

/**
 * Monetization Architecture V1 — FROZEN WORKING MODEL.
 * Keep customer fare rules intact; change revenue floor + pickup economics.
 */
export const MONETIZATION_V1 = {
  minimumPlatformContribution: {
    [ServiceType.BIKE]: 1000,
    [ServiceType.CAR]: 2000,
    [ServiceType.SEND]: 1500,
    [ServiceType.MART]: 1500, // applies to MART delivery leg
  } as Record<ServiceType, number>,
  pickup: {
    normalRadiusKm: 2,
    extendedRadiusKm: 3,
    exceptionalCap: 1000,
  },
  merchantFee: {
    onboardingRate: 0,
    standardRate: 0.03,
    maxEarlyRate: 0.05,
  },
} as const;

export function minimumPlatformContribution(serviceType: ServiceType): number {
  return MONETIZATION_V1.minimumPlatformContribution[serviceType] ?? 0;
}

export function calculatePlatformContribution(
  serviceType: ServiceType,
  commissionBase: number,
  commissionRate: number,
): { percentageAmount: number; minimumAmount: number; contribution: number } {
  const percentageAmount = Math.max(0, Math.round(Math.max(0, commissionBase) * Math.max(0, commissionRate)));
  const minimumAmount = minimumPlatformContribution(serviceType);
  return {
    percentageAmount,
    minimumAmount,
    contribution: Math.max(percentageAmount, minimumAmount),
  };
}

export type PickupDispatchClass = 'NORMAL' | 'EXTENDED' | 'EXCEPTIONAL';

export function calculateSmartPickupCompensation(distanceKmInput: number): {
  compensation: number;
  dispatchClass: PickupDispatchClass;
  effectiveRatePerKm: number;
} {
  const distanceKm = Math.max(0, Number.isFinite(distanceKmInput) ? distanceKmInput : 0);
  const { normalRadiusKm, extendedRadiusKm, exceptionalCap } = MONETIZATION_V1.pickup;
  let compensation = 0;
  let dispatchClass: PickupDispatchClass = 'NORMAL';

  // FIX: sebelumnya batas jarak (1/2/3 km) hardcoded terpisah dari
  // MONETIZATION_V1.pickup.normalRadiusKm/extendedRadiusKm, sehingga
  // mengubah konfigurasi tidak berpengaruh apa-apa terhadap perilaku.
  if (distanceKm <= 1) {
    compensation = 0;
  } else if (distanceKm <= normalRadiusKm) {
    compensation = 500;
  } else if (distanceKm <= extendedRadiusKm) {
    compensation = 750;
    dispatchClass = 'EXTENDED';
  } else {
    compensation = exceptionalCap;
    dispatchClass = 'EXCEPTIONAL';
  }

  return {
    compensation,
    dispatchClass,
    effectiveRatePerKm: distanceKm > 0 ? Math.round(compensation / distanceKm) : 0,
  };
}

export function projectedNetContribution(input: {
  serviceType: ServiceType;
  commissionBase: number;
  commissionRate: number;
  pickupDistanceKm: number;
  merchantContribution?: number;
}) {
  const platform = calculatePlatformContribution(input.serviceType, input.commissionBase, input.commissionRate);
  const pickup = calculateSmartPickupCompensation(input.pickupDistanceKm);
  const merchantContribution = Math.max(0, Math.round(input.merchantContribution ?? 0));
  return {
    platformGross: platform.contribution + merchantContribution,
    pickupCompensation: pickup.compensation,
    projectedNet: platform.contribution + merchantContribution - pickup.compensation,
    dispatchClass: pickup.dispatchClass,
  };
}
