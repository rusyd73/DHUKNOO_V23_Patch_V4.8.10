import { ServiceType } from '@prisma/client';
import { calculatePlatformContribution, calculateSmartPickupCompensation, projectedNetContribution } from '../../src/modules/tariff/monetization.policy';

describe('Monetization Architecture V1 policy', () => {
  test.each([
    [0.5, 0, 'NORMAL'],
    [1, 0, 'NORMAL'],
    [2, 500, 'NORMAL'],
    [3, 750, 'EXTENDED'],
    [5, 1000, 'EXCEPTIONAL'],
  ])('pickup %s km => Rp%s %s', (km, amount, dispatchClass) => {
    const result = calculateSmartPickupCompensation(km as number);
    expect(result.compensation).toBe(amount);
    expect(result.dispatchClass).toBe(dispatchClass);
  });

  it('menegakkan minimum contribution per layanan', () => {
    expect(calculatePlatformContribution(ServiceType.BIKE, 6800, 0.08).contribution).toBe(1000);
    expect(calculatePlatformContribution(ServiceType.CAR, 20500, 0.07).contribution).toBe(2000);
    expect(calculatePlatformContribution(ServiceType.SEND, 11500, 0.08).contribution).toBe(1500);
  });

  it('projected contribution tidak negatif untuk BIKE pendek + exceptional pickup karena cap', () => {
    const result = projectedNetContribution({serviceType: ServiceType.BIKE, commissionBase: 6800, commissionRate: 0.08, pickupDistanceKm: 5});
    expect(result.projectedNet).toBe(0);
    expect(result.dispatchClass).toBe('EXCEPTIONAL');
  });
});
