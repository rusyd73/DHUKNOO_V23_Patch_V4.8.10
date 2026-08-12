import { prisma } from '../../../config/prisma';
import { logger } from '../../../config/logger';

export interface DriverEligibilityResult {
  isEligible: boolean;
  reasons: string[];
  score: number;
  metadata?: {
    distanceKm?: number;
    balance?: number;
    minimumDeposit?: number;
    activeOrders?: number;
    pendingCashOrders?: number;
    todayOrders?: number;
  };
}

export interface DriverEligibilityInput {
  driverId: string;
  order: {
    serviceType: string;
    pickupLat: number;
    pickupLng: number;
    dropoffLat?: number;
    dropoffLng?: number;
  };
  options?: {
    minimumDeposit?: number;
    maxDistanceKm?: number;
    maxDailyOrders?: number;
    checkLocationFreshness?: boolean;
    locationFreshnessMinutes?: number;
  };
}

export class DriverEligibilityService {
  // ============================================================
  // 🔒 SATU FUNGSI UNTUK SEMUA JALUR
  // ============================================================
  async check(input: DriverEligibilityInput): Promise<DriverEligibilityResult> {
    const { driverId, order, options } = input;
    const {
      minimumDeposit = 20000,
      maxDistanceKm = 5,
      maxDailyOrders = 20,
    } = options || {};

    const reasons: string[] = [];
    let score = 100;
    const metadata: any = {};

    // STEP 1: Ambil data driver
    const driver = await prisma.driverProfile.findUnique({
      where: { id: driverId },
      include: {
        user: true,
        documents: true,
      },
    });

    if (!driver) {
      return {
        isEligible: false,
        reasons: ['Driver not found'],
        score: 0,
        metadata,
      };
    }

    metadata.balance = 0;
    metadata.minimumDeposit = minimumDeposit;

    // STEP 2: Account Active
    if (!driver.user?.isActive) {
      reasons.push('Account tidak aktif');
      score -= 50;
    }

    // STEP 3: Verified
    if (!driver.isVerified) {
      reasons.push('Akun driver belum diverifikasi');
      score -= 40;
    }

    // STEP 4: Online
    if (!driver.isOnline) {
      reasons.push('Driver sedang offline');
      score -= 30;
    }

    // STEP 5: Dokumen valid
    const hasValidDocs = driver.documents?.some(
      doc => doc.status === 'APPROVED'
    );
    if (!hasValidDocs) {
      reasons.push('Tidak ada dokumen yang disetujui');
      score -= 30;
    }

    // STEP 6: MINIMUM DEPOSIT
    const wallet = await prisma.wallet.findUnique({
      where: { userId: driver.userId },
    });
    const balance = Number(wallet?.balance || 0);
    metadata.balance = balance;

    if (balance < minimumDeposit) {
      reasons.push(
        `Saldo tidak mencukupi (Rp${balance.toLocaleString('id-ID')} < Rp${minimumDeposit.toLocaleString('id-ID')})`
      );
      score -= 25;
    }

    // STEP 7: SERVICE TYPE MATCH
    const isSendOrMart = order.serviceType === 'SEND' || order.serviceType === 'MART';
    if (!isSendOrMart && driver.serviceType !== order.serviceType) {
      reasons.push(
        `Tipe layanan tidak sesuai (driver: ${driver.serviceType}, order: ${order.serviceType})`
      );
      score -= 50;
    }

    // STEP 8: AKTIF ORDER
    const activeOrder = await prisma.order.findFirst({
      where: {
        driverId,
        status: { in: ['ACCEPTED', 'ON_THE_WAY', 'ARRIVED'] },
      },
    });
    if (activeOrder) {
      reasons.push('Driver sedang dalam perjalanan');
      score -= 40;
    }
    metadata.activeOrders = activeOrder ? 1 : 0;

    // STEP 9: PENDING CASH ORDER
    const pendingCashCount = await prisma.order.count({
      where: {
        driverId,
        paymentMethod: 'CASH',
        isPaid: false,
        status: 'COMPLETED',
      },
    });
    if (pendingCashCount > 0) {
      reasons.push(`Ada ${pendingCashCount} order CASH belum dikonfirmasi`);
      score -= 20;
    }
    metadata.pendingCashOrders = pendingCashCount;

    // STEP 10: DAILY ORDER LIMIT
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayOrdersCount = await prisma.order.count({
      where: {
        driverId,
        status: { in: ['ACCEPTED', 'ON_THE_WAY', 'ARRIVED', 'COMPLETED'] },
        acceptedAt: { gte: today },
      },
    });
    if (todayOrdersCount >= maxDailyOrders) {
      reasons.push(`Batas order harian tercapai (${maxDailyOrders} order)`);
      score -= 10;
    }
    metadata.todayOrders = todayOrdersCount;

    // STEP 11: DISTANCE
    if (driver.latitude && driver.longitude) {
      const distance = this.calculateDistance(
        driver.latitude,
        driver.longitude,
        order.pickupLat,
        order.pickupLng
      );
      metadata.distanceKm = distance;

      if (distance > maxDistanceKm) {
        reasons.push(`Terlalu jauh (${distance.toFixed(1)}km dari pickup, maks ${maxDistanceKm}km)`);
        score -= 20;
      }
    } else {
      reasons.push('Lokasi driver tidak diketahui');
      score -= 20;
    }

    // FINAL: DECISION
    const isEligible = score >= 70 && reasons.length === 0;

    if (!isEligible) {
      logger.warn(`[ELIGIBILITY] Driver ${driverId} not eligible:`, {
        reasons,
        score,
        metadata,
      });
    }

    return {
      isEligible,
      reasons,
      score: Math.max(score, 0),
      metadata,
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

  // ============================================================
  // 🔒 FILTER BANYAK DRIVER
  // ============================================================
  async filterEligibleDrivers(
    driverIds: string[],
    order: {
      serviceType: string;
      pickupLat: number;
      pickupLng: number;
    },
    options?: {
      minimumDeposit?: number;
      maxDistanceKm?: number;
      maxDailyOrders?: number;
    }
  ): Promise<{ driverId: string; eligibility: DriverEligibilityResult }[]> {
    const results: { driverId: string; eligibility: DriverEligibilityResult }[] = [];

    for (const driverId of driverIds) {
      const result = await this.check({
        driverId,
        order,
        options,
      });
      if (result.isEligible) {
        results.push({ driverId, eligibility: result });
      }
    }

    return results;
  }
}

// ✅ EXPORT INSTANCE UNTUK KEMUDAHAN
export const driverEligibilityService = new DriverEligibilityService();