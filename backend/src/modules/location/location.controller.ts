import { Response } from 'express';
import { AuthenticatedRequest } from '../../core/middleware/auth.middleware';
import { LocationService } from './location.service';
import { logger } from '../../config/logger';
import { AppError } from '../../core/errors/AppError';
import { prisma } from '../../config/prisma';
import { TariffEngineService } from '../tariff/tariff.service';

const LOCATION_UPDATE_MIN_INTERVAL_MS = 2000; // 2 detik minimal antar update

export class LocationController {
  private locationService = new LocationService();
  private tariffEngine = new TariffEngineService();
  private lastUpdateTime = new Map<string, number>();

  // ============================================================
  // 🔒 UPDATE DRIVER LOCATION - DENGAN THROTTLE
  // ============================================================
  updateMine = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const { latitude, longitude, isOnline } = req.body;

      // Validasi koordinat
      if (latitude === undefined || longitude === undefined) {
        return res.status(400).json({ success: false, error: 'Latitude and longitude required' });
      }

      if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
        return res.status(400).json({ success: false, error: 'Invalid coordinates' });
      }

      // ============================================================
      // 🔒 SERVER-SIDE THROTTLE (2 detik minimal antar update)
      // ============================================================
      const now = Date.now();
      const last = this.lastUpdateTime.get(userId) || 0;
      
      if (now - last < LOCATION_UPDATE_MIN_INTERVAL_MS) {
        return res.status(200).json({
          success: true,
          message: 'Location update throttled',
          throttled: true,
        });
      }
      
      this.lastUpdateTime.set(userId, now);

      // ============================================================
      // 🔒 UPDATE KE REDIS (BUKAN POSTGRESQL)
      // ============================================================
      await this.locationService.updateMyLocationWithCache(
        userId,
        latitude,
        longitude,
        isOnline
      );

      return res.status(200).json({
        success: true,
        message: 'Location updated',
      });

    } catch (err: any) {
      logger.error('LocationController.updateMine error:', err);
      const status = err instanceof AppError ? err.statusCode : 500;
      return res.status(status).json({
        success: false,
        error: err.message || 'Failed to update location',
      });
    }
  };

  // ============================================================
  // 🔒 GET DRIVER LOCATION
  // ============================================================
  getForDriver = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { driverId } = req.params;
      
      const location = await this.locationService.getDriverLocation(driverId);
      
      return res.status(200).json({
        success: true,
        data: location,
      });

    } catch (err: any) {
      logger.error('LocationController.getForDriver error:', err);
      const status = err instanceof AppError ? err.statusCode : 404;
      return res.status(status).json({
        success: false,
        error: err.message || 'Failed to get location',
      });
    }
  };

  // ============================================================
  // 🔒 LIST ONLINE DRIVERS
  // ============================================================
  listOnline = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const drivers = await this.locationService.listOnlineDrivers();
      return res.status(200).json({
        success: true,
        data: drivers,
        count: drivers.length,
      });
    } catch (err: any) {
      logger.error('LocationController.listOnline error:', err);
      return res.status(500).json({
        success: false,
        error: err.message || 'Failed to list online drivers',
      });
    }
  };

  // Ringkasan privat untuk customer: hanya jumlah dan jarak terdekat,
  // tidak pernah mengirim identitas atau koordinat driver.
  nearbyAvailability = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const latitude = Number(req.query.latitude);
      const longitude = Number(req.query.longitude);
      const serviceType = String(req.query.serviceType || 'BIKE');
      const vehicleRequirement = String(req.query.vehicleRequirement || 'AUTO');
      const radiusKm = Math.min(Math.max(Number(req.query.radiusKm || 5), 1), 10);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return res.status(400).json({ success: false, error: 'Koordinat titik jemput tidak valid.' });
      }
      if (!['BIKE', 'CAR', 'SEND', 'MART'].includes(serviceType)) {
        return res.status(400).json({ success: false, error: 'Jenis layanan tidak valid.' });
      }
      if (!['AUTO', 'BIKE', 'CAR'].includes(vehicleRequirement)) {
        return res.status(400).json({ success: false, error: 'Kebutuhan kendaraan tidak valid.' });
      }

      const minimumDeposit = await this.tariffEngine.getMinimumDriverDeposit();
      const drivers = await prisma.driverProfile.findMany({
        where: {
          isOnline: true,
          isVerified: true,
          latitude: { not: null },
          longitude: { not: null },
          user: { isActive: true },
          orders: { none: { status: { in: ['ACCEPTED', 'ON_THE_WAY', 'ARRIVED', 'PICKED_UP', 'ARRIVED_CUSTOMER'] } } },
          ...(serviceType === 'SEND' || serviceType === 'MART' ? {} : { serviceType: serviceType as any }),
          // SEND dipublikasikan ke BIKE dan CAR. Pilihan armada menjadi
          // rekomendasi pada detail kiriman, bukan filter availability.
        },
        include: { user: { select: { wallet: { select: { balance: true } } } } },
        take: 200,
      });

      const toRad = (value: number) => value * Math.PI / 180;
      const distanceKm = (lat: number, lng: number) => {
        const dLat = toRad(lat - latitude);
        const dLng = toRad(lng - longitude);
        const a = Math.sin(dLat / 2) ** 2
          + Math.cos(toRad(latitude)) * Math.cos(toRad(lat)) * Math.sin(dLng / 2) ** 2;
        return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
      };
      const eligibleDistances = drivers
        .filter((driver) => Number(driver.user.wallet?.balance || 0) >= minimumDeposit)
        .map((driver) => distanceKm(Number(driver.latitude), Number(driver.longitude)))
        .filter((distance) => distance <= radiusKm)
        .sort((a, b) => a - b);

      return res.status(200).json({
        success: true,
        data: {
          availableCount: eligibleDistances.length,
          nearestDistanceKm: eligibleDistances.length ? Math.round(eligibleDistances[0] * 10) / 10 : null,
          radiusKm,
          serviceType,
          vehicleRequirement,
          checkedAt: new Date().toISOString(),
        },
      });
    } catch (err: any) {
      logger.error('LocationController.nearbyAvailability error:', err);
      return res.status(500).json({ success: false, error: 'Gagal memeriksa ketersediaan driver.' });
    }
  };

  // ============================================================
  // 🔓 SEARCH ADDRESS
  // ============================================================
  searchAddress = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { query } = req.query;
      const results = await this.locationService.searchAddress(query as string);
      return res.status(200).json({
        success: true,
        data: results,
      });
    } catch (err: any) {
      logger.error('LocationController.searchAddress error:', err);
      return res.status(500).json({
        success: false,
        error: err.message || 'Failed to search address',
      });
    }
  };

  // ============================================================
  // 🔓 REVERSE GEOCODE
  // ============================================================
  reverseGeocode = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { latitude, longitude } = req.query;
      const result = await this.locationService.reverseGeocode(
        Number(latitude),
        Number(longitude)
      );
      return res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      logger.error('LocationController.reverseGeocode error:', err);
      return res.status(500).json({
        success: false,
        error: err.message || 'Failed to reverse geocode',
      });
    }
  };

  // ============================================================
  // 🔓 CALCULATE DISTANCE
  // ============================================================
  calculateDistance = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { origin, destination } = req.body;
      const result = await this.locationService.calculateDistance(origin, destination);
      return res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      logger.error('LocationController.calculateDistance error:', err);
      return res.status(500).json({
        success: false,
        error: err.message || 'Failed to calculate distance',
      });
    }
  };

  // ============================================================
  // 🔓 ESTIMATE ETA
  // ============================================================
  estimateETA = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { distanceMeters, speed } = req.body;
      const result = await this.locationService.estimateETA(distanceMeters, speed);
      return res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      logger.error('LocationController.estimateETA error:', err);
      return res.status(500).json({
        success: false,
        error: err.message || 'Failed to estimate ETA',
      });
    }
  };

  // ============================================================
  // 🔓 ROUTE POLYLINE
  // ============================================================
  routePolyline = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { origin, destination } = req.body;
      const result = await this.locationService.routePolyline(origin, destination);
      return res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      logger.error('LocationController.routePolyline error:', err);
      return res.status(500).json({
        success: false,
        error: err.message || 'Failed to get route polyline',
      });
    }
  };

  // ============================================================
  // 🔓 NEAREST DRIVERS
  // ============================================================
  nearestDrivers = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { coordinate, limit } = req.body;
      const drivers = await this.locationService.nearestDrivers(coordinate, limit);
      return res.status(200).json({
        success: true,
        data: drivers,
      });
    } catch (err: any) {
      logger.error('LocationController.nearestDrivers error:', err);
      return res.status(500).json({
        success: false,
        error: err.message || 'Failed to get nearest drivers',
      });
    }
  };

  // ============================================================
  // 🔓 GEOFENCE
  // ============================================================
  geofence = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { center, point, radius } = req.body;
      const result = await this.locationService.geofence({ center, point, radius });
      return res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err: any) {
      logger.error('LocationController.geofence error:', err);
      return res.status(500).json({
        success: false,
        error: err.message || 'Failed to check geofence',
      });
    }
  };
}
