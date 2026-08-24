import { calculateMartPaymentSplit } from '../../src/modules/payment/payment.service';

describe('calculateMartPaymentSplit', () => {
  it('merekonsiliasi kasus MART Rp41.779: barang, ongkir, driver, merchant, dan platform tidak boleh hilang', () => {
    const result = calculateMartPaymentSplit(41779, 0, 25000, 0.08, 0.1);

    expect(result.deliveryFee.toNumber()).toBe(16779);
    expect(result.driverCommission.toNumber()).toBeCloseTo(1342.32, 2);
    expect(result.driverEarning.toNumber()).toBeCloseTo(15436.68, 2);
    expect(result.merchantFee.toNumber()).toBe(0);
    expect(result.merchantEarning.toNumber()).toBe(25000);
    expect(result.platformFee.toNumber()).toBeCloseTo(1342.32, 2);
    expect(
      result.driverEarning.plus(result.merchantEarning).plus(result.platformFee).toNumber()
    ).toBe(41779);
  });

  it('memisahkan order MART jadi 3 bagian: merchant (barang), driver (ongkir), platform (sisanya)', () => {
    // itemsSubtotal 50000, harga total 65000 (tanpa diskon) -> ongkir = 15000
    // Nilai pokok produk 100% hak merchant; parameter fee legacy diabaikan.
    // driverCommissionRate 8% (tier ongkir <=20rb) -> komisi 1200, driver earning 13800
    const result = calculateMartPaymentSplit(65000, 0, 50000, 0.08, 0.1);

    expect(result.amountToCharge.toNumber()).toBe(65000);
    expect(result.itemsSubtotal.toNumber()).toBe(50000);
    expect(result.deliveryFee.toNumber()).toBe(15000);

    expect(result.merchantFee.toNumber()).toBe(0);
    expect(result.merchantEarning.toNumber()).toBe(50000);

    expect(result.driverCommission.toNumber()).toBeCloseTo(1200, 5);
    expect(result.driverEarning.toNumber()).toBeCloseTo(13800, 5);
  });

  it('TIDAK PERNAH menghitung komisi driver dari nilai barang -- hanya dari ongkir (bug yang diperbaiki)', () => {
    // Order besar: barang 500rb, ongkir cuma 10rb. Sebelum perbaikan, driver
    // akan menerima ~90%+ dari 510rb (nilai barang ikut kena "komisi" seolah
    // itu ongkir). Setelah perbaikan, driver HANYA berhak atas bagian ongkir.
    const result = calculateMartPaymentSplit(510000, 0, 500000, 0.08, 0.1);

    expect(result.deliveryFee.toNumber()).toBe(10000);
    expect(result.driverEarning.toNumber()).toBeLessThan(10000);
    expect(result.driverEarning.toNumber()).toBeCloseTo(9200, 5); // 10000 - 8%
    expect(result.merchantEarning.toNumber()).toBe(500000); // 100% nilai produk
  });

  it('merchant TIDAK PERNAH dapat Rp0 untuk order yang punya barang bernilai (bug yang diperbaiki)', () => {
    const result = calculateMartPaymentSplit(65000, 0, 50000, 0.08, 0.1);
    expect(result.merchantEarning.toNumber()).toBeGreaterThan(0);
  });

  it('total earning (merchant + driver + platform fee) harus selalu sama dengan amountToCharge (tidak ada uang hilang/bertambah)', () => {
    const result = calculateMartPaymentSplit(137500, 12500, 80000, 0.07, 0.12);
    const total = result.merchantEarning.plus(result.driverEarning).plus(result.platformFee);
    expect(total.toNumber()).toBeCloseTo(result.amountToCharge.toNumber(), 5);
  });

  it('mengurangi diskon dari total SEBELUM menghitung ongkir (diskon dianggap memotong ongkir dulu)', () => {
    // Harga 65000, diskon 10000 -> ditagih 55000, barang tetap 50000 -> ongkir jadi 5000
    const result = calculateMartPaymentSplit(65000, 10000, 50000, 0.08, 0.1);

    expect(result.amountToCharge.toNumber()).toBe(55000);
    expect(result.deliveryFee.toNumber()).toBe(5000);
    expect(result.merchantEarning.toNumber()).toBe(50000); // nilai barang tidak terpengaruh diskon ongkir
  });

  it('platformFee hanya berasal dari komisi ongkos driver', () => {
    const result = calculateMartPaymentSplit(65000, 0, 50000, 0.08, 0.1);
    expect(result.merchantFee.toNumber()).toBe(0);
    expect(result.platformFee.toNumber()).toBeCloseTo(result.driverCommission.toNumber(), 5);
  });
});
