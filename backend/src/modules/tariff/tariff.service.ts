import { ServiceType } from '@prisma/client';
import { TariffRepository } from './tariff.repository';
import { AppError } from '../../core/errors/AppError';
import { logger } from '../../config/logger';

export interface TariffCalculationInput {
  serviceType: ServiceType;
  distanceKm: number;
  // 🚫 SEMUA PARAMETER FINANSIAL TIDAK DIPERCAYA DARI CLIENT
  // Semua akan dihitung/dideteksi server-side
  zoneName?: string;        // 🚫 IGNORE - deteksi dari koordinat
  waitMinutes?: number;     // 🚫 IGNORE - dihitung dari timestamp
  hasToll?: boolean;        // 🚫 IGNORE - deteksi dari routing
  hasParking?: boolean;     // 🚫 IGNORE - ditentukan driver/event
  isBadWeather?: boolean;   // 🚫 IGNORE - deteksi dari weather API
  isHoliday?: boolean;      // 🚫 IGNORE - deteksi dari kalender
  promoDiscount?: number;   // 🚫 IGNORE - dihitung dari promo code
  // 🔒 KOORDINAT UNTUK DETEKSI SERVER-SIDE
  pickupLat?: number;
  pickupLng?: number;
  dropoffLat?: number;
  dropoffLng?: number;
  // 🔒 TIMESTAMP UNTUK WAIT TIME
  createdAt?: Date;
  acceptedAt?: Date;
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
  orderType?: 'MART';
  itemsSubtotal?: number;
  merchantFeeRate?: number;
  merchantFeeAmount?: number;
  merchantEarning?: number;
}

export class TariffEngineService {
  private tariffRepo = new TariffRepository();

  // ============================================================
  // 🔒 ZONE CENTERS (SERVER-SIDE REFERENCE)
  // ============================================================
  private readonly ZONE_CENTERS: Record<string, { lat: number; lng: number; radiusKm: number }> = {
    'Kota Malang': { lat: -7.9666, lng: 112.6326, radiusKm: 10 },
    'Kota Batu': { lat: -7.8671, lng: 112.5239, radiusKm: 8 },
    'Malang Raya': { lat: -7.9666, lng: 112.6326, radiusKm: 30 },
  };

  // ============================================================
  // 🔒 DETEKSI ZONE (SERVER-SIDE)
  // ============================================================
  private async detectZone(lat: number, lng: number): Promise<string | null> {
    const zones = await this.tariffRepo.listZones();
    let detected: string | null = null;
    let minDistance = Infinity;

    for (const zone of zones) {
      const center = this.ZONE_CENTERS[zone.name];
      if (!center) continue;
      const distance = this.calculateDistance(lat, lng, center.lat, center.lng);
      if (distance <= center.radiusKm && distance < minDistance) {
        minDistance = distance;
        detected = zone.name;
      }
    }

    if (detected) {
      logger.info(`[ZONE] Detected: ${detected} (${minDistance.toFixed(2)}km)`);
      return detected;
    }
    return null;
  }

  // ============================================================
  // 🔒 DETEKSI HOLIDAY (SERVER-SIDE)
  // ============================================================
  private async detectHoliday(date: Date): Promise<boolean> {
    const dateStr = date.toISOString().split('T')[0];
    const holiday = await this.tariffRepo.findHoliday(dateStr);
    if (holiday) return true;
    // Cek hari Minggu
    return date.getDay() === 0;
  }

  // ============================================================
  // 🔒 DETEKSI WEATHER (SERVER-SIDE)
  // ============================================================
  private async detectBadWeather(lat: number, lng: number): Promise<boolean> {
    // 🔥 Implementasi: panggil Weather API (OpenWeatherMap)
    // Sementara: return false
    return false;
  }

  // ============================================================
  // 🔒 DETEKSI TOLL (SERVER-SIDE)
  // ============================================================
  private async detectToll(
    pickupLat: number,
    pickupLng: number,
    dropoffLat: number,
    dropoffLng: number
  ): Promise<boolean> {
    // 🔥 Implementasi: cek route dengan OSRM/Google Maps
    // Sementara: return false
    return false;
  }

  // ============================================================
  // 🔒 DETEKSI PARKING (SERVER-SIDE)
  // ============================================================
  private async detectParking(dropoffLat: number, dropoffLng: number): Promise<boolean> {
    // 🔥 Implementasi: cek apakah dropoff di area parkir berbayar
    // Sementara: return false
    return false;
  }

  // ============================================================
  // 🔒 HITUNG WAIT TIME (SERVER-SIDE)
  // ============================================================
  private calculateWaitTime(createdAt: Date, acceptedAt?: Date): number {
    const now = new Date();
    const startTime = acceptedAt || createdAt;
    const diffMinutes = (now.getTime() - startTime.getTime()) / 60000;
    return Math.max(0, Math.floor(diffMinutes));
  }

  // ============================================================
  // 🔥 CALCULATE FARE - SEMUA PARAMETER DARI SERVER
  // ============================================================
  async calculateFare(input: TariffCalculationInput): Promise<TariffBreakdown> {
    // 🔒 STEP 1: ZONE - deteksi dari koordinat
    let zoneId: string | null = null;
    if (input.pickupLat && input.pickupLng) {
      const detectedZone = await this.detectZone(input.pickupLat, input.pickupLng);
      if (detectedZone) {
        const zone = await this.tariffRepo.findZoneByName(detectedZone);
        if (zone) zoneId = zone.id;
      }
    }

    // 🔒 STEP 2: HOLIDAY - deteksi server-side
    const isHoliday = await this.detectHoliday(new Date());

    // 🔒 STEP 3: WEATHER - deteksi server-side
    let isBadWeather = false;
    if (input.pickupLat && input.pickupLng) {
      isBadWeather = await this.detectBadWeather(input.pickupLat, input.pickupLng);
    }

    // 🔒 STEP 4: TOLL - deteksi server-side
    let hasToll = false;
    if (input.pickupLat && input.pickupLng && input.dropoffLat && input.dropoffLng) {
      hasToll = await this.detectToll(
        input.pickupLat,
        input.pickupLng,
        input.dropoffLat,
        input.dropoffLng
      );
    }

    // 🔒 STEP 5: PARKING - deteksi server-side
    let hasParking = false;
    if (input.dropoffLat && input.dropoffLng) {
      hasParking = await this.detectParking(input.dropoffLat, input.dropoffLng);
    }

    // 🔒 STEP 6: WAIT TIME - dihitung dari timestamp
    const waitMinutes = this.calculateWaitTime(
      input.createdAt || new Date(),
      input.acceptedAt
    );

    // 🔒 STEP 7: PROMO DISCOUNT - akan dihitung dari PromoService
    // input.promoDiscount IGNORE

    // ✅ LOG semua parameter yang sebenarnya dipakai
    logger.info(`[TARIFF] Server-side params: zone=${zoneId}, holiday=${isHoliday}, weather=${isBadWeather}, toll=${hasToll}, wait=${waitMinutes}min, parking=${hasParking}`);

    // STEP 8: Cari PricingRule
    let rule = zoneId ? await this.tariffRepo.findActiveRule(input.serviceType, zoneId) : null;
    if (!rule) {
      rule = await this.tariffRepo.findFallbackRule(input.serviceType);
    }
    if (!rule) {
      throw new AppError(
        `Tidak ada aturan tarif (PricingRule) aktif untuk layanan ${input.serviceType}. Hubungi Admin untuk mengatur tarif dasar terlebih dahulu.`,
        400
      );
    }

    // STEP 9: Komponen dasar
    const baseFare = Number(rule.baseFare);
    const pickupFee = Number(rule.pickupFee);
    const distanceFee = Number(rule.perKmFee) * Math.max(0, input.distanceKm);
    const waitFee = Number(rule.perMinuteWaitFee) * Math.max(0, waitMinutes);

    // STEP 10: Komponen regional
    let tollFee = 0;
    let parkingFee = 0;
    let weatherSurcharge = 0;
    let holidaySurcharge = 0;

    if (zoneId) {
      const policy = await this.tariffRepo.findActiveRegionalPolicy(zoneId);
      if (policy) {
        tollFee = hasToll ? Number(policy.tollFee) : 0;
        parkingFee = hasParking ? Number(policy.parkingFee) : 0;
        weatherSurcharge = isBadWeather ? Number(policy.weatherSurcharge) : 0;
        holidaySurcharge = isHoliday ? Number(policy.holidaySurcharge) : 0;
      }
    }

    // 🔒 PROMO DISCOUNT - dihitung terpisah (bukan dari input)
    const promoDiscount = 0;

    const subtotal =
      baseFare + pickupFee + distanceFee + waitFee + tollFee + parkingFee + weatherSurcharge + holidaySurcharge;
    const finalFare = Math.max(0, subtotal - promoDiscount);

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
      zoneId,
    };
  }

  // ============================================================
  // 🔒 HITUNG JARAK (Haversine)
  // ============================================================
  private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371;
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lon2 - lon1);
    const a = Math.sin(dLat/2)**2 + 
              Math.cos(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) * 
              Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }

  private toRad(deg: number): number {
    return deg * Math.PI / 180;
  }

  async resolveCommissionRate(orderValue: number): Promise<{ rate: number; tariffVersionId: string | null }> {
    const activeVersion = await this.tariffRepo.findActiveTariffVersion();
    if (!activeVersion) {
      return { rate: 0.2, tariffVersionId: null };
    }

    const tiers = activeVersion.commissionTiers as unknown as Array<{ maxOrderValue: number | null; rate: number }>;
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

  async getMinimumDriverDeposit(): Promise<number> {
    const config = await this.tariffRepo.getConfig('MINIMUM_DRIVER_DEPOSIT');
    if (!config) return 20000;
    const parsed = Number(config.value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 20000;
  }

  async getMerchantPlatformFeeRate(): Promise<number> {
    const config = await this.tariffRepo.getConfig('MERCHANT_PLATFORM_FEE_RATE');
    if (!config) return 0.1;
    const parsed = Number(config.value);
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 0.1;
  }
}