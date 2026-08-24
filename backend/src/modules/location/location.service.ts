import { LocationRepository } from "./location.repository";
import { MapProvider } from "./map.provider";
import { SocketService } from "../../websocket/socket";
import { OrderRepository } from "../order/order.repository";
import { RedisService } from "../../config/redis";
import {
  Coordinate,
  GeofenceRequest,
} from "./map.types";
import {
  NotFoundError,
} from "../../core/errors/AppError";
import { logger } from "../../config/logger";

const LOCATION_PREFIX = 'driver:location:';
const LOCATION_TTL = 60;
const SNAPSHOT_INTERVAL = 60;

export class LocationService {
  private locationRepo = new LocationRepository();
  private mapProvider = new MapProvider();
  private orderRepo = new OrderRepository();
  private static lastSnapshot = new Map<string, number>();

  /*
  |--------------------------------------------------------------------------
  | Update Driver Location - DENGAN REDIS CACHE
  |--------------------------------------------------------------------------
  */
  async updateMyLocationWithCache(
    userId: string,
    latitude: number,
    longitude: number,
    isOnline?: boolean
  ) {
    // STEP 1: UPDATE KE REDIS (CEPAT)
    const key = `${LOCATION_PREFIX}${userId}`;
    const data = JSON.stringify({
      lat: latitude,
      lng: longitude,
      updatedAt: new Date().toISOString(),
      isOnline: isOnline ?? true,
    });
    await RedisService.setex(key, LOCATION_TTL, data);
    logger.debug(`[LOCATION] Driver ${userId} location updated in Redis`);

    // STEP 2: UPDATE KE REDIS GEO (untuk nearest driver)
    await RedisService.geoadd('driver:locations:geo', longitude, latitude, userId);

    // STEP 3: BROADCAST VIA SOCKET
    SocketService.emitToRoom("map_updates", "location_changed", {
      driverId: userId,
      latitude,
      longitude,
      timestamp: new Date(),
    });

    SocketService.emitToRoom(`driver_${userId}`, "driver_location_updated", {
      latitude,
      longitude,
    });

    try {
      const activeOrder = await this.orderRepo.findActiveOrderForDriver(userId);
      if (activeOrder) {
        SocketService.emitToOrder(activeOrder.id, "location_changed", {
          driverId: userId,
          latitude,
          longitude,
        });
      }
    } catch {
      // Best-effort
    }

    // STEP 4: SNAPSHOT KE DATABASE.
    // Saat driver baru ONLINE, koordinat WAJIB disimpan sinkron sebelum
    // request /jobs/eligibility berikutnya. Sebelumnya hanya setImmediate,
    // sehingga Redis sudah benar tetapi PostgreSQL masih null/basi dan
    // publikasi lama tidak pernah terlihat oleh driver yang terlambat online.
    const last = LocationService.lastSnapshot.get(userId) || 0;
    const now = Date.now();

    if (isOnline === true) {
      await this.locationRepo.updateDriverLocation(userId, latitude, longitude, true);
      LocationService.lastSnapshot.set(userId, now);
      logger.debug(`[LOCATION] Online driver ${userId} location synchronously saved to DB`);
      SocketService.emitToUser(userId, 'jobs_refresh_required', {
        reason: 'ONLINE_LOCATION_READY',
      });
    } else if (now - last > SNAPSHOT_INTERVAL * 1000) {
      setImmediate(async () => {
        try {
          await this.locationRepo.updateDriverLocation(
            userId,
            latitude,
            longitude,
            isOnline
          );
          LocationService.lastSnapshot.set(userId, now);
          logger.debug(`[LOCATION] Snapshot saved to DB for driver ${userId}`);
        } catch (err) {
          logger.error(`[LOCATION] Failed to snapshot driver ${userId}:`, err);
        }
      });
    }

    return { id: userId, latitude, longitude };
  }

  /*
  |--------------------------------------------------------------------------
  | ⚠️ LEGACY: Update Driver Location (LANGSUNG KE DB - HANYA UNTUK FALLBACK)
  |--------------------------------------------------------------------------
  */
  async updateMyLocation(
    userId: string,
    latitude: number,
    longitude: number,
    isOnline?: boolean
  ) {
    return this.updateMyLocationWithCache(userId, latitude, longitude, isOnline);
  }

  /*
  |--------------------------------------------------------------------------
  | Get Driver Location - DARI REDIS (CACHE)
  |--------------------------------------------------------------------------
  */
  async getCachedLocation(driverId: string): Promise<{
    lat: number;
    lng: number;
    updatedAt: string;
    isOnline: boolean;
  } | null> {
    const key = `${LOCATION_PREFIX}${driverId}`;
    const data = await RedisService.get(key);
    if (!data) return null;

    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  /*
  |--------------------------------------------------------------------------
  | Remove Location (Driver Offline)
  |--------------------------------------------------------------------------
  */
  async removeCachedLocation(driverId: string): Promise<void> {
    const key = `${LOCATION_PREFIX}${driverId}`;
    await RedisService.del(key);
    await RedisService.zrem('driver:locations:geo', driverId);
    LocationService.lastSnapshot.delete(driverId);
    logger.info(`[LOCATION] Driver ${driverId} location removed from Redis`);
  }

  /*
  |--------------------------------------------------------------------------
  | Get Nearby Drivers - DARI REDIS GEO (CEPAT)
  |--------------------------------------------------------------------------
  */
    async getNearbyDriversFromCache(
    lat: number,
    lng: number,
    radiusKm: number = 5
  ): Promise<any[]> {
    const results = await RedisService.geosearch(
      'driver:locations:geo',
      lng,
      lat,
      radiusKm,
      'km'
    );

    const drivers: any[] = [];
    for (const item of results) {
      const coords = await RedisService.geopos('driver:locations:geo', item.member);
      if (coords && coords.length > 0 && coords[0]) {
        drivers.push({
          driverId: item.member,
          distanceMeters: Math.round(item.distance * 1000),
          distanceKm: item.distance,
          latitude: coords[0][1],
          longitude: coords[0][0],
        });
      }
    }

    return drivers;
  }

  /*
  |--------------------------------------------------------------------------
  | Search Address
  |--------------------------------------------------------------------------
  */
  searchAddress(keyword: string) {
    return this.mapProvider.searchAddress(keyword);
  }

  /*
  |--------------------------------------------------------------------------
  | Reverse Geocode
  |--------------------------------------------------------------------------
  */
  reverseGeocode(latitude: number, longitude: number) {
    return this.mapProvider.reverseGeocode(latitude, longitude);
  }

  /*
  |--------------------------------------------------------------------------
  | Calculate Distance
  |--------------------------------------------------------------------------
  */
  calculateDistance(origin: Coordinate, destination: Coordinate) {
    return this.mapProvider.calculateDistance(origin, destination);
  }

  /*
  |--------------------------------------------------------------------------
  | Estimate ETA
  |--------------------------------------------------------------------------
  */
  estimateETA(distanceMeters: number, speed: number) {
    return this.mapProvider.estimateETA(distanceMeters, speed);
  }

  /*
  |--------------------------------------------------------------------------
  | Route Polyline
  |--------------------------------------------------------------------------
  */
  routePolyline(origin: Coordinate, destination: Coordinate) {
    return this.mapProvider.routePolyline(origin, destination);
  }

  /*
  |--------------------------------------------------------------------------
  | Snap To Road
  |--------------------------------------------------------------------------
  */
  snapToRoad(coordinate: Coordinate) {
    return this.mapProvider.snapToRoad(coordinate);
  }

  /*
  |--------------------------------------------------------------------------
  | Driver Location
  |--------------------------------------------------------------------------
  */
  async getDriverLocation(driverId: string) {
    // CEK DARI REDIS DULU
    const cached = await this.getCachedLocation(driverId);
    if (cached) {
      return {
        id: driverId,
        latitude: cached.lat,
        longitude: cached.lng,
        updatedAt: cached.updatedAt,
      };
    }

    // Fallback ke database
    const location = await this.locationRepo.findDriverLocation(driverId);
    if (!location) {
      throw new NotFoundError("Driver tidak ditemukan!");
    }
    return location;
  }

  /*
  |--------------------------------------------------------------------------
  | Online Drivers
  |--------------------------------------------------------------------------
  */
  listOnlineDrivers() {
    return this.locationRepo.listOnlineDrivers();
  }
  

  /*
  |--------------------------------------------------------------------------
  | Nearest Drivers - PAKAI REDIS GEO (O(log N))
  |--------------------------------------------------------------------------
  */
  async nearestDrivers(coordinate: Coordinate, limit: number = 10) {
    const drivers = await this.getNearbyDriversFromCache(
      coordinate.latitude,
      coordinate.longitude,
      5
    );
    return drivers.slice(0, limit);
  }

  /*
  |--------------------------------------------------------------------------
  | Geofence
  |--------------------------------------------------------------------------
  */
  geofence(request: GeofenceRequest) {
    const distance = this.mapProvider.calculateDistance(
      request.center,
      request.point
    );
    return {
      inside: distance.distanceMeters <= request.radius,
      radius: request.radius,
      distance: distance.distanceMeters,
    };
  }
}
