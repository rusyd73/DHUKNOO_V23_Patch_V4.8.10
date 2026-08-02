import { PromoService } from '../../src/modules/promo/promo.service';
import { PromoRepository } from '../../src/modules/promo/promo.repository';

// Mock seluruh repository — test ini murni menguji LOGIC perhitungan diskon,
// tidak menyentuh database sama sekali, jadi bisa jalan di mana saja tanpa Postgres.
jest.mock('../../src/modules/promo/promo.repository');

const MockedPromoRepository = PromoRepository as jest.MockedClass<typeof PromoRepository>;

function buildPromo(overrides: Partial<any> = {}) {
  return {
    id: 'promo-1',
    code: 'OBAMA10',
    type: 'PERCENTAGE',
    value: 10,
    maxDiscount: 5000,
    minOrderPrice: 10000,
    quota: 100,
    usedCount: 0,
    isActive: true,
    expiresAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

describe('PromoService.validateAndPreview', () => {
  let service: PromoService;
  let findActiveByCodeMock: jest.Mock;

  beforeEach(() => {
    MockedPromoRepository.mockClear();
    service = new PromoService();
    findActiveByCodeMock = (service as any).promoRepo.findActiveByCode;
  });

  it('menghitung diskon PERCENTAGE dengan benar, di bawah maxDiscount', async () => {
    findActiveByCodeMock.mockResolvedValue(buildPromo({ value: 10, maxDiscount: 5000 }));

    const result = await service.validateAndPreview('OBAMA10', 20000);

    // 10% dari 20000 = 2000, masih di bawah maxDiscount 5000
    expect(result.discount).toBe(2000);
    expect(result.finalPrice).toBe(18000);
  });

  it('membatasi diskon PERCENTAGE sampai maxDiscount jika melebihi', async () => {
    findActiveByCodeMock.mockResolvedValue(buildPromo({ value: 50, maxDiscount: 5000 }));

    // 50% dari 100000 = 50000, seharusnya dipotong jadi maxDiscount = 5000
    const result = await service.validateAndPreview('OBAMA10', 100000);

    expect(result.discount).toBe(5000);
    expect(result.finalPrice).toBe(95000);
  });

  it('menghitung diskon FIXED apa adanya (tidak melebihi harga order)', async () => {
    findActiveByCodeMock.mockResolvedValue(
      buildPromo({ type: 'FIXED', value: 15000, maxDiscount: undefined, minOrderPrice: 0 })
    );

    const result = await service.validateAndPreview('OBAMA10', 10000);

    // Diskon FIXED 15000 tapi harga order cuma 10000 -> diskon dipotong jadi 10000
    expect(result.discount).toBe(10000);
    expect(result.finalPrice).toBe(0);
  });

  it('menolak jika kode promo tidak ditemukan', async () => {
    findActiveByCodeMock.mockResolvedValue(null);

    await expect(service.validateAndPreview('TIDAKADA', 20000)).rejects.toThrow(
      'Kode promo tidak ditemukan atau sudah tidak aktif!'
    );
  });

  it('menolak jika order di bawah minOrderPrice', async () => {
    findActiveByCodeMock.mockResolvedValue(buildPromo({ minOrderPrice: 50000 }));

    await expect(service.validateAndPreview('OBAMA10', 20000)).rejects.toThrow(/Minimal order/);
  });

  it('menolak jika kuota promo sudah habis', async () => {
    findActiveByCodeMock.mockResolvedValue(buildPromo({ quota: 5, usedCount: 5 }));

    await expect(service.validateAndPreview('OBAMA10', 20000)).rejects.toThrow(/Kuota/);
  });

  it('menolak jika promo sudah kedaluwarsa', async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    findActiveByCodeMock.mockResolvedValue(buildPromo({ expiresAt: yesterday }));

    await expect(service.validateAndPreview('OBAMA10', 20000)).rejects.toThrow(/kedaluwarsa/);
  });
});
