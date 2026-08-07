import { ServiceType } from '@prisma/client';
import { TariffRepository } from './tariff.repository';
import { AppError } from '../../core/errors/AppError';

export interface TariffCalculationInput {
  serviceType: ServiceType;
  distanceKm: number;
  zoneName?: string; // mis. "Kota Batu" — kalau tidak dikirim, pakai rule fallback umum
  waitMinutes?: number; // Biaya Tunggu
  hasToll?: boolean; // apakah rute lewat tol
  hasParking?: boolean; // apakah butuh biaya parkir
  isBadWeather?: boolean; // Cuaca
  isHoliday?: boolean; // Hari Libur
  promoDiscount?: number; // Promo (nominal potongan, sudah dihitung dari PromoService)
}

export interface TariffBreakdown {
  baseFare: number;
  pickupFee: number;
  distanceFee: number;
  waitFee: number;
  tollFee: number;
  parkingFee: number;
  weatherSurcharge: number;
  holidaySurcharge: number;
  promoDiscount: number;
  finalFare: number;
  commissionRate: number;
  commissionAmount: number;
  driverEarning: number;
  tariffVersionId: string | null;
  zoneId: string | null;
  // 🆕 Field khusus order MART (checkout dari toko/Merchant). Order BIKE/CAR/SEND
  // biasa tidak mengisi field ini (tetap undefined), supaya struktur lama tidak
  // berubah. Disimpan di sini (bukan kolom baru di tabel Order) supaya nilainya
  // TERKUNCI pada saat checkout — persis seperti commissionRate driver — dan
  // tidak berubah retroaktif walau Admin mengubah rate platform fee merchant
  // di kemudian hari.
  orderType?: 'MART';
  itemsSubtotal?: number; // total harga barang (belum termasuk ongkir)
  merchantFeeRate?: number; // platform fee dari merchant, mis. 0.1 = 10%
  merchantFeeAmount?: number; // itemsSubtotal * merchantFeeRate
  merchantEarning?: number; // itemsSubtotal - merchantFeeAmount (masuk ke wallet merchant)
}

/**
 * TariffEngineService — mesin tarif terpusat. SEMUA komponen harga (tarif
 * dasar, biaya pickup, biaya perjalanan, biaya tunggu, tol, parkir, cuaca,
 * hari libur, promo) dan komisi platform (tiered berdasarkan nilai order)
 * dibaca dari database (PricingRule, RegionalPolicy, TariffVersion), BUKAN
 * hardcode di kode program. Admin bisa ubah semuanya lewat panel Admin
 * tanpa perlu rilis aplikasi baru.
 */
export class TariffEngineService {
  private tariffRepo = new TariffRepository();

  async calculateFare(input: TariffCalculationInput): Promise<TariffBreakdown> {
    const zone = input.zoneName ? await this.tariffRepo.findZoneByName(input.zoneName) : null;

    // 1. Cari PricingRule: prioritas rule spesifik-zona, fallback ke rule umum (zoneId null)
    let rule = zone ? await this.tariffRepo.findActiveRule(input.serviceType, zone.id) : null;
    if (!rule) {
      rule = await this.tariffRepo.findFallbackRule(input.serviceType);
    }
    if (!rule) {
      throw new AppError(
        `Tidak ada aturan tarif (PricingRule) aktif untuk layanan ${input.serviceType}. Hubungi Admin untuk mengatur tarif dasar terlebih dahulu.`,
        400
      );
    }

    // 2. Komponen dasar dari PricingRule
    const baseFare = Number(rule.baseFare);
    const pickupFee = Number(rule.pickupFee);
    const distanceFee = Number(rule.perKmFee) * Math.max(0, input.distanceKm);
    const waitFee = Number(rule.perMinuteWaitFee) * Math.max(0, input.waitMinutes || 0);

    // 3. Komponen regional (tol, parkir, cuaca, hari libur) dari RegionalPolicy zona tsb
    let tollFee = 0;
    let parkingFee = 0;
    let weatherSurcharge = 0;
    let holidaySurcharge = 0;

    if (zone) {
      const policy = await this.tariffRepo.findActiveRegionalPolicy(zone.id);
      if (policy) {
        tollFee = input.hasToll ? Number(policy.tollFee) : 0;
        parkingFee = input.hasParking ? Number(policy.parkingFee) : 0;
        weatherSurcharge = input.isBadWeather ? Number(policy.weatherSurcharge) : 0;
        holidaySurcharge = input.isHoliday ? Number(policy.holidaySurcharge) : 0;
      }
    }

    const promoDiscount = Math.max(0, input.promoDiscount || 0);

    // 4. Tarif Akhir = Tarif Dasar + Pickup + Perjalanan + Tunggu + Tol + Parkir + Cuaca + Hari Libur - Promo
    const subtotal =
      baseFare + pickupFee + distanceFee + waitFee + tollFee + parkingFee + weatherSurcharge + holidaySurcharge;
    const finalFare = Math.max(0, subtotal - promoDiscount);

    // 5. Komisi platform TIERED berdasarkan nilai order akhir, dibaca dari TariffVersion aktif
    const { rate: commissionRate, tariffVersionId } = await this.resolveCommissionRate(finalFare);
    const commissionAmount = finalFare * commissionRate;
    const driverEarning = finalFare - commissionAmount;

    return {
      baseFare,
      pickupFee,
      distanceFee,
      waitFee,
      tollFee,
      parkingFee,
      weatherSurcharge,
      holidaySurcharge,
      promoDiscount,
      finalFare,
      commissionRate,
      commissionAmount,
      driverEarning,
      tariffVersionId,
      zoneId: zone?.id ?? null,
    };
  }

  /**
   * Mencari tarif komisi (rate) yang berlaku untuk sebuah nilai order, berdasarkan
   * tier yang didefinisikan di TariffVersion yang sedang aktif. Kalau belum ada
   * TariffVersion aktif sama sekali, jatuh ke default aman 20% (supaya sistem
   * tidak pernah gagal total hanya karena Admin belum sempat setup tariff engine).
   */
  async resolveCommissionRate(orderValue: number): Promise<{ rate: number; tariffVersionId: string | null }> {
    const activeVersion = await this.tariffRepo.findActiveTariffVersion();
    if (!activeVersion) {
      return { rate: 0.2, tariffVersionId: null };
    }

    const tiers = activeVersion.commissionTiers as unknown as Array<{ maxOrderValue: number | null; rate: number }>;
    // Tiers diasumsikan terurut naik berdasarkan maxOrderValue (null = tier terakhir/tanpa batas)
    const sorted = [...tiers].sort((a, b) => {
      if (a.maxOrderValue === null) return 1;
      if (b.maxOrderValue === null) return -1;
      return a.maxOrderValue - b.maxOrderValue;
    });

    const matched = sorted.find((t) => t.maxOrderValue === null || orderValue <= t.maxOrderValue);
    return { rate: matched ? matched.rate : 0.2, tariffVersionId: activeVersion.id };
  }

  async recordPricingHistory(orderId: string, breakdown: TariffBreakdown) {
    return this.tariffRepo.savePricingHistory(orderId, breakdown.tariffVersionId, breakdown);
  }

  /**
   * Nilai minimum deposit yang wajib dimiliki driver sebelum bisa menerima order,
   * diatur Admin lewat PlatformConfig (key: MINIMUM_DRIVER_DEPOSIT). Kalau belum
   * pernah di-set sama sekali, jatuh ke default aman Rp20.000 (bukan 0), supaya
   * gerbang deposit tetap aktif secara wajar walau Admin belum sempat mengatur nilainya.
   */
  async getMinimumDriverDeposit(): Promise<number> {
    const config = await this.tariffRepo.getConfig('MINIMUM_DRIVER_DEPOSIT');
    if (!config) return 20000;
    const parsed = Number(config.value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 20000;
  }

  /**
   * 🆕 Platform fee yang dipotong dari MERCHANT (bukan driver) untuk setiap
   * penjualan barang lewat checkout MART — sebelumnya belum ada sama sekali
   * di ekosistem tarif engine ini (hanya ada komisi driver dari TariffVersion).
   * Nilainya berupa rate 0..1 (mis. 0.1 = 10%), diatur Admin lewat endpoint
   * PlatformConfig yang sama seperti MINIMUM_DRIVER_DEPOSIT (key:
   * "MERCHANT_PLATFORM_FEE_RATE"), tanpa perlu rilis aplikasi baru. Kalau
   * Admin belum pernah mengatur, jatuh ke default aman 10% (bukan 0%),
   * supaya platform tidak pernah kehilangan pendapatan dari sisi merchant
   * hanya karena belum sempat dikonfigurasi.
   */
  async getMerchantPlatformFeeRate(): Promise<number> {
    const config = await this.tariffRepo.getConfig('MERCHANT_PLATFORM_FEE_RATE');
    if (!config) return 0.1;
    const parsed = Number(config.value);
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 0.1;
  }
}
