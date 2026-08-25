import { calculateMartPaymentSplit } from '../../src/modules/payment/payment.service';

describe('calculateMartPaymentSplit — Monetization Architecture V1', () => {
  it('onboarding 0%: merchant tetap menerima 100% barang, delivery memakai minimum contribution MART Rp1.500', () => {
    const result = calculateMartPaymentSplit(41779, 0, 25000, 0.08, 0);
    expect(result.deliveryFee.toNumber()).toBe(16779);
    expect(result.driverCommission.toNumber()).toBe(1500);
    expect(result.driverEarning.toNumber()).toBe(15279);
    expect(result.merchantFee.toNumber()).toBe(0);
    expect(result.merchantEarning.toNumber()).toBe(25000);
    expect(result.platformFee.toNumber()).toBe(1500);
    expect(result.driverEarning.plus(result.merchantEarning).plus(result.platformFee).toNumber()).toBe(41779);
  });

  it('standard 3%: merchant contribution dipisahkan dari delivery contribution', () => {
    const result = calculateMartPaymentSplit(65000, 0, 50000, 0.08, 0.03);
    expect(result.deliveryFee.toNumber()).toBe(15000);
    expect(result.merchantFee.toNumber()).toBe(1500);
    expect(result.merchantEarning.toNumber()).toBe(48500);
    expect(result.driverCommission.toNumber()).toBe(1500);
    expect(result.driverEarning.toNumber()).toBe(13500);
    expect(result.platformFee.toNumber()).toBe(3000);
    expect(result.driverEarning.plus(result.merchantEarning).plus(result.platformFee).toNumber()).toBe(65000);
  });

  it('merchant fee early-stage tidak boleh melebihi cap 5%', () => {
    const result = calculateMartPaymentSplit(65000, 0, 50000, 0.08, 0.25);
    expect(result.merchantFeeRate).toBe(0.05);
    expect(result.merchantFee.toNumber()).toBe(2500);
    expect(result.merchantEarning.toNumber()).toBe(47500);
  });

  it('komisi delivery tidak pernah dihitung dari nilai barang', () => {
    const result = calculateMartPaymentSplit(510000, 0, 500000, 0.08, 0);
    expect(result.deliveryFee.toNumber()).toBe(10000);
    expect(result.driverCommission.toNumber()).toBe(1500);
    expect(result.driverEarning.toNumber()).toBe(8500);
    expect(result.merchantEarning.toNumber()).toBe(500000);
  });

  it('rekonsiliasi selalu sama dengan amountToCharge', () => {
    const result = calculateMartPaymentSplit(137500, 12500, 80000, 0.07, 0.03);
    const total = result.merchantEarning.plus(result.driverEarning).plus(result.platformFee);
    expect(total.toNumber()).toBeCloseTo(result.amountToCharge.toNumber(), 5);
  });
});
