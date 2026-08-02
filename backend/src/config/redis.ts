import Redis from 'ioredis';
import { logger } from './logger';
import { ENV } from './env';

export class RedisService {
  private static client: Redis | null = null;
  private static isConnected = false;
  private static inMemoryCache = new Map<string, { value: string; expiresAt: number | null }>();

  public static async init(): Promise<void> {
    if (!ENV.REDIS_URL) {
      logger.info('Redis URL not configured. Redis Caching will use in-memory fallback.');
      return;
    }

    try {
      logger.info(`Connecting to Redis at: ${ENV.REDIS_URL}`);
      this.client = new Redis(ENV.REDIS_URL, {
        maxRetriesPerRequest: 3,
        retryStrategy: (times) => {
          if (times > 3) {
            logger.warn('Redis reconnection failed after 3 attempts. Falling back to in-memory.');
            this.isConnected = false;
            return null; // Stop retrying
          }
          return Math.min(times * 100, 1000);
        },
      });

      this.client.on('connect', () => {
        this.isConnected = true;
        logger.info('Redis connection established successfully.');
      });

      this.client.on('error', (err) => {
        logger.error('Redis Client Error: %s', err.message);
        this.isConnected = false;
      });
    } catch (err) {
      logger.error('Failed to initialize Redis client: %s', (err as Error).message || err);
      this.isConnected = false;
    }
  }

  public static getClient(): Redis | null {
    return this.client;
  }

  public static async get(key: string): Promise<string | null> {
    if (this.isConnected && this.client) {
      try {
        return await this.client.get(key);
      } catch (err) {
        logger.error(`Error getting key ${key} from Redis: %s`, (err as Error).message);
      }
    }

    // Fallback to in-memory cache
    const item = this.inMemoryCache.get(key);
    if (!item) return null;
    if (item.expiresAt && Date.now() > item.expiresAt) {
      this.inMemoryCache.delete(key);
      return null;
    }
    return item.value;
  }

  public static async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (this.isConnected && this.client) {
      try {
        if (ttlSeconds) {
          await this.client.set(key, value, 'EX', ttlSeconds);
        } else {
          await this.client.set(key, value);
        }
        return;
      } catch (err) {
        logger.error(`Error setting key ${key} in Redis: %s`, (err as Error).message);
      }
    }

    // Fallback to in-memory cache
    const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : null;
    this.inMemoryCache.set(key, { value, expiresAt });
  }

  /**
   * 🔥 BARU: Set key dengan TTL (expiry) - sama seperti set tapi lebih eksplisit
   * Digunakan untuk menyimpan socketId driver dengan masa berlaku
   */
  public static async setex(key: string, seconds: number, value: string): Promise<void> {
    if (this.isConnected && this.client) {
      try {
        await this.client.setex(key, seconds, value);
        return;
      } catch (err) {
        logger.error(`Error setex key ${key} in Redis: %s`, (err as Error).message);
      }
    }

    // Fallback to in-memory cache
    const expiresAt = seconds ? Date.now() + seconds * 1000 : null;
    this.inMemoryCache.set(key, { value, expiresAt });
  }

  public static async del(key: string): Promise<void> {
    if (this.isConnected && this.client) {
      try {
        await this.client.del(key);
        return;
      } catch (err) {
        logger.error(`Error deleting key ${key} in Redis: %s`, (err as Error).message);
      }
    }
    this.inMemoryCache.delete(key);
  }

  /**
   * 🔥 BARU: Mencari semua key yang match dengan pattern
   * Digunakan untuk mencari socketId driver yang terdaftar
   */
  public static async keys(pattern: string): Promise<string[]> {
    if (this.isConnected && this.client) {
      try {
        return await this.client.keys(pattern);
      } catch (err) {
        logger.error(`Error getting keys with pattern ${pattern} from Redis: %s`, (err as Error).message);
        return [];
      }
    }

    // Fallback to in-memory cache
    const result: string[] = [];
    const regex = new RegExp(pattern.replace(/\*/g, '.*'));
    for (const key of this.inMemoryCache.keys()) {
      if (regex.test(key)) {
        result.push(key);
      }
    }
    return result;
  }

  /**
   * 🔥 BARU: Publish message ke channel (untuk event-driven architecture)
   */
  public static async publish(channel: string, message: string): Promise<void> {
    if (this.isConnected && this.client) {
      try {
        await this.client.publish(channel, message);
      } catch (err) {
        logger.error(`Error publishing to channel ${channel}: %s`, (err as Error).message);
      }
    }
  }

  /**
   * 🔥 BARU: Subscribe ke channel (untuk event-driven architecture)
   */
  public static async subscribe(channel: string, callback: (message: string) => void): Promise<void> {
    if (this.isConnected && this.client) {
      try {
        await this.client.subscribe(channel);
        this.client.on('message', (ch, msg) => {
          if (ch === channel) {
            callback(msg);
          }
        });
        logger.info(`Subscribed to Redis channel: ${channel}`);
      } catch (err) {
        logger.error(`Error subscribing to channel ${channel}: %s`, (err as Error).message);
      }
    }
  }

  /**
   * 🔥 BARU: Unsubscribe dari channel
   */
  public static async unsubscribe(channel: string): Promise<void> {
    if (this.isConnected && this.client) {
      try {
        await this.client.unsubscribe(channel);
        logger.info(`Unsubscribed from Redis channel: ${channel}`);
      } catch (err) {
        logger.error(`Error unsubscribing from channel ${channel}: %s`, (err as Error).message);
      }
    }
  }

  /**
   * 🔥 BARU: Hapus semua key dengan pattern tertentu
   * Digunakan untuk cleanup
   */
  public static async delPattern(pattern: string): Promise<void> {
    const keys = await this.keys(pattern);
    if (keys.length > 0) {
      for (const key of keys) {
        await this.del(key);
      }
      logger.info(`Deleted ${keys.length} keys with pattern: ${pattern}`);
    }
  }

  /**
   * 🔥 BARU: Cek apakah Redis terhubung
   */
  public static isReady(): boolean {
    return this.isConnected;
  }

  /**
   * 🔥 BARU: Clear semua in-memory cache (untuk testing)
   */
  public static clearMemoryCache(): void {
    this.inMemoryCache.clear();
  }
}