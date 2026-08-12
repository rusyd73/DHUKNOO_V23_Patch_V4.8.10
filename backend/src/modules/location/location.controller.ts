import { Response } from 'express';
import { AuthenticatedRequest } from '../../core/middleware/auth.middleware';
import { LocationService } from './location.service';
import { logger } from '../../config/logger';
import { AppError } from '../../core/errors/AppError';

const LOCATION_UPDATE_MIN_INTERVAL_MS = 2000; // 2 detik minimal antar update

export class LocationController {
  private locationService = new LocationService();
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