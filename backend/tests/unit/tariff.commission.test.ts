import { TariffEngineService } from '../../src/modules/tariff/tariff.service';
import { TariffRepository } from '../../src/modules/tariff/tariff.repository';

jest.mock('../../src/modules/tariff/tariff.repository');

const MockedTariffRepository = TariffRepository as jest.MockedClass<typeof TariffRepository>;

const TIERED_COMMISSION_VERSION = {
  id: 'version-1',
  versionName: 'v-test-tiered',
  isActive: true,
  commissionTiers: [
    { maxOrderValue: 20000, rate: 0.08 },
    { maxOrderValue: 50000, rate: 0.07 },
    { maxOrderValue: 100000, rate: 0.06 },
    { maxOrderValue: null, rate: 0.05 },
  ],
};

describe('TariffEngineService.resolveCommissionRate', () => {
  let service: TariffEngineService;
  let findActiveTariffVersionMock: jest.Mock;

  beforeEach(() => {
    MockedTariffRepository.mockClear();
    service = new TariffEngineService();
    findActiveTariffVersionMock = (service as any).tariffRepo.findActiveTariffVersion;
  });

  it.each([
    { orderValue: 20000, expectedRate: 0.08, label: 'tepat di batas tier 1 (≤20rb → 8%)' },
    { orderValue: 20001, expectedRate: 0.07, label: 'tepat di atas tier 1 (20.001 → 7%)' },
    { orderValue: 50000, expectedRate: 0.07, label: 'tepat di batas tier 2 (≤50rb → 7%)' },
    { orderValue: 75000, expectedRate: 0.06, label: 'di tengah tier 3 (50.001-100rb → 6%)' },
    { orderValue: 100000, expectedRate: 0.06, label: 'tepat di batas tier 3 (≤100rb → 6%)' },
    { orderValue: 500000, expectedRate: 0.05, label: 'jauh di atas semua batas (>100rb → 5%)' },
  ])('memilih tier yang benar untuk $label', async ({ orderValue, expectedRate }) => {
    findActiveTariffVersionMock.mockResolvedValue(TIERED_COMMISSION_VERSION);

    const { rate, tariffVersionId } = await service.resolveCommissionRate(orderValue);

    expect(rate).toBe(expectedRate);
    expect(tariffVersionId).toBe('version-1');
  });

  it('jatuh ke default 20% kalau belum ada TariffVersion aktif sama sekali', async () => {
    findActiveTariffVersionMock.mockResolvedValue(null);

    const { rate, tariffVersionId } = await service.resolveCommissionRate(50000);

    expect(rate).toBe(0.2);
    expect(tariffVersionId).toBeNull();
  });
});
