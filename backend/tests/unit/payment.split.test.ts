import { calculatePaymentSplit } from '../../src/modules/payment/payment.service';

describe('calculatePaymentSplit', () => {
  it('membagi harga tanpa diskon dengan tarif komisi 20%: driver dapat 80%, platform 20%', () => {
    const { amountToCharge, platformFee, driverEarning } = calculatePaymentSplit(20000, 0, 0.2);

    expect(amountToCharge.toNumber()).toBe(20000);
    expect(platformFee.toNumber()).toBe(4000);
    expect(driverEarning.toNumber()).toBe(16000);
  });

  it('mengurangi diskon dari harga SEBELUM menghitung komisi platform', () => {
    // Harga 20000, diskon 5000 -> ditagih 15000 -> fee 20% = 3000 -> driver 12000
    const { amountToCharge, platformFee, driverEarning } = calculatePaymentSplit(20000, 5000, 0.2);

    expect(amountToCharge.toNumber()).toBe(15000);
    expect(platformFee.toNumber()).toBe(3000);
    expect(driverEarning.toNumber()).toBe(12000);
  });

  it('driverEarning + platformFee harus selalu sama dengan amountToCharge (tidak ada uang hilang/bertambah)', () => {
    const { amountToCharge, platformFee, driverEarning } = calculatePaymentSplit(137500, 12500, 0.15);

    expect(driverEarning.plus(platformFee).toNumber()).toBe(amountToCharge.toNumber());
  });

  it('menangani harga 0 (order gratis penuh oleh promo) tanpa error', () => {
    const { amountToCharge, platformFee, driverEarning } = calculatePaymentSplit(10000, 10000, 0.2);

    expect(amountToCharge.toNumber()).toBe(0);
    expect(platformFee.toNumber()).toBe(0);
    expect(driverEarning.toNumber()).toBe(0);
  });

  // Tarif komisi TIERED sesuai kebijakan Tariff Engine:
  // ≤20rb: 8%, 20.001-50rb: 7%, 50.001-100rb: 6%, >100rb: 5%
  it.each([
    { price: 15000, rate: 0.08, label: 'tier 1 (≤20rb, 8%)' },
    { price: 35000, rate: 0.07, label: 'tier 2 (20.001-50rb, 7%)' },
    { price: 75000, rate: 0.06, label: 'tier 3 (50.001-100rb, 6%)' },
    { price: 250000, rate: 0.05, label: 'tier 4 (>100rb, 5%)' },
  ])('menghitung komisi dengan benar untuk $label', ({ price, rate }) => {
    const { amountToCharge, platformFee, driverEarning } = calculatePaymentSplit(price, 0, rate);

    expect(amountToCharge.toNumber()).toBe(price);
    expect(platformFee.toNumber()).toBeCloseTo(price * rate, 5);
    expect(driverEarning.toNumber()).toBeCloseTo(price * (1 - rate), 5);
  });
});
