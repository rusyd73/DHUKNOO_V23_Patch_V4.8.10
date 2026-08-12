// modules/location/location.repository.ts
import { prisma } from '../../config/prisma';
import { RedisService } from '../../config/redis';
import { logger } from '../../config/logger';

const LOCATION_GEO_KEY = 'driver:locations:geo';

export class LocationRepository {
  // ============================================================
  // 🔒 UPDATE DRIVER LOCATION - PAKAI REDIS GEO (O(1))
  // ============================================================
  // modules/location/location.repository.ts
async updateDriverLocation(
  userId: string,
  latitude: number,
  longitude: number,
  isOnline?: boolean
): Promise<any> {
  return prisma.driverProfile.update({
    where: { userId: userId },
    data: {
      latitude,
      longitude,
      isOnline: isOnline ?? true,
    },
  });
}

  // ============================================================
  // 🔒 GET NEAREST DRIVERS - PAKAI REDIS GEOSEARCH (O(log N + M))
  // ============================================================
  async getNearestDriversFromRedis(
    latitude: number,
    longitude: number,
    radiusKm: number = 5,
    limit: number = 10
  ): Promise<{ driverId: string; distanceMeters: number; latitude: number; longitude: number }[]> {
    // ✅ Redis GEOSEARCH - hanya ambil driver dalam radius (O(log N + M))
    // M = jumlah driver dalam radius (bukan total semua driver)
    const results = await RedisService.geosearch(
      LOCATION_GEO_KEY,
      longitude,
      latitude,
      radiusKm,
      'km'
    );

    return results.slice(0, limit).map((item: any) => ({
      driverId: item.member,
      distanceMeters: Math.round(item.distance * 1000), // km → meter
      latitude: 0, // Redis GEO tidak return koordinat, perlu get tambahan
      longitude: 0,
    }));
  }

  // ============================================================
  // 🔒 GET DRIVER LOCATION DARI REDIS
  // ============================================================
  async getDriverLocationFromRedis(driverId: string): Promise<{ latitude: number; longitude: number } | null> {
    const result = await RedisService.geopos(LOCATION_GEO_KEY, driverId);
    if (!result || result.length === 0 || !result[0]) return null;
    return {
      longitude: result[0][0],
      latitude: result[0][1],
    };
  }

  // ============================================================
  // 🔒 REMOVE DRIVER DARI REDIS GEO
  // ============================================================
  async removeDriverFromRedis(driverId: string): Promise<void> {
    await RedisService.zrem(LOCATION_GEO_KEY, driverId);
  }

  // ============================================================
  // ⚠️ LEGACY: Get All Online Drivers (JANGAN DIPAKAI UNTUK NEAREST)
  // ============================================================
  async listOnlineDrivers(): Promise<any[]> {
    // HANYA untuk admin/display, BUKAN untuk nearest driver
    return prisma.driverProfile.findMany({
      where: {
        isOnline: true,
        isVerified: true,
        latitude: { not: null },
        longitude: { not: null },
      },
      select: {
        id: true,
        latitude: true,
        longitude: true,
        userId: true,
        user: {
          select: { fullName: true },
        },
      },
    });
  }

  // ============================================================
  // 🔒 FIND DRIVER LOCATION (FALLBACK KE DB)
  // ============================================================
  async findDriverLocation(driverId: string): Promise<any> {
    // Cek Redis dulu
    const redisLoc = await this.getDriverLocationFromRedis(driverId);
    if (redisLoc) {
      return {
        id: driverId,
        latitude: redisLoc.latitude,
        longitude: redisLoc.longitude,
      };
    }

    // Fallback ke database
    return prisma.driverProfile.findUnique({
      where: { id: driverId },
      select: {
        id: true,
        latitude: true,
        longitude: true,
      },
    });
  }
}