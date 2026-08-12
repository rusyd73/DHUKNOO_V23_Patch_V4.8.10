import axios from 'axios';
import Redis from 'ioredis';
import { logger } from '../../config/logger';

export class DistanceService {
  private redis: Redis;

  constructor() {
    const url = process.env.REDIS_URL || 'redis://localhost:6379';
    this.redis = new Redis(url);
  }

  async getVerifiedDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
    clientDistance?: number
  ) {
    // Validasi koordinat
    if (lat1 < -90 || lat1 > 90 || lat2 < -90 || lat2 > 90 ||
        lon1 < -180 || lon1 > 180 || lon2 < -180 || lon2 > 180) {
      return {
        roadDistance: clientDistance || 0,
        straightDistance: 0,
        error: 'Invalid coordinates',
        manipulationDetected: false,
        manipulationSevere: false
      };
    }

    const straight = this.calculateStraight(lat1, lon1, lat2, lon2);
    const road = await this.getRoadDistance(lat1, lon1, lat2, lon2);

    let manipulationDetected = false;
    let manipulationSevere = false;

    if (clientDistance && clientDistance > 0) {
      const diff = Math.abs(straight - clientDistance);
      const percentDiff = straight > 0 ? diff / straight : 0;
      if (percentDiff > 0.2) {
        manipulationDetected = true;
        if (percentDiff > 0.5) {
          manipulationSevere = true;
        }
        logger.warn('[SECURITY] Distance manipulation detected:', {
          clientDistance,
          actual: straight,
          diff,
          percentDiff,
        });
      }
    }

    return {
      straightDistance: straight,
      roadDistance: road || straight * 1.3,
      manipulationDetected,
      manipulationSevere
    };
  }

  private calculateStraight(lat1: number, lon1: number, lat2: number, lon2: number): number {
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

  private async getRoadDistance(lat1: number, lon1: number, lat2: number, lon2: number): Promise<number> {
    const cacheKey = `road:${lat1},${lon1}:${lat2},${lon2}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return parseFloat(cached);

    try {
      const osrmUrl = process.env.OSRM_URL || 'http://router.project-osrm.org';
      const response = await axios.get(
        `${osrmUrl}/route/v1/driving/${lon1},${lat1};${lon2},${lat2}`,
        { timeout: 3000 }
      );
      if (response.data.routes?.[0]) {
        const distance = response.data.routes[0].distance / 1000;
        await this.redis.setex(cacheKey, 3600, distance.toString());
        return distance;
      }
    } catch (e) {
      // Fallback
    }
    return this.calculateStraight(lat1, lon1, lat2, lon2) * 1.3;
  }
}