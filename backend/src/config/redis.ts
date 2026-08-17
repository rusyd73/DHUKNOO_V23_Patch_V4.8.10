import Redis from 'ioredis';
import { logger } from './logger';
import { ENV } from './env';

export class RedisService {
  private static client: Redis | null = null;
  private static isConnected = false;
  private static inMemoryCache = new Map<string, { value: string; expiresAt: number | null }>();
  private static inMemorySets = new Map<string, Set<string>>();
  private static inMemoryGeo = new Map<string, Map<string, { longitude: number; latitude: number; timestamp: number }>>();

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
            return null;
          }
          return Math.min(times * 100, 1000);
        },
      });

      // 🆕 FIX P0/P1 "Redis readiness" (audit): SEBELUMNYA hanya event
      // 'connect' & 'error' yang didengarkan. 'connect' di ioredis fire
      // begitu koneksi TCP terbentuk, SEBELUM handshake Redis (AUTH/SELECT
      // dll) selesai -- bukan sinyal paling akurat bahwa client benar-benar
      // siap menerima command. Dan kalau koneksi terputus BERSIH (server
      // Redis restart, network partition tanpa error eksplisit), ioredis
      // memancarkan 'close'/'reconnecting', BUKAN SELALU 'error' -- tanpa
      // listener untuk itu, `isConnected` tetap TERKUNCI true selamanya
      // walau koneksi sudah lama putus, dan getRedisOrThrow() di
      // dispatch.redis.ts akan terus mengira Redis sehat.
      //
      // Sekarang pakai event 'ready' (fire setelah handshake SUNGGUHAN
      // selesai, sinyal paling akurat "siap pakai") untuk set true, dan
      // tambahkan listener 'close'/'reconnecting' untuk set false segera
      // begitu koneksi terputus dengan cara APA PUN -- readiness flag ini
      // sekarang benar-benar mencerminkan status koneksi real-time.
      this.client.on('ready', () => {
        this.isConnected = true;
        logger.info('Redis connection established successfully.');
      });

      this.client.on('error', (err) => {
        logger.error('Redis Client Error: %s', err.message);
        this.isConnected = false;
      });

      this.client.on('close', () => {
        logger.warn('Redis connection closed.');
        this.isConnected = false;
      });

      this.client.on('reconnecting', () => {
        this.isConnected = false;
      });

      // 🆕 FIX race condition: sebelumnya init() resolve LANGSUNG setelah
      // client dibuat, TANPA menunggu handshake selesai -- caller (mis.
      // bootstrap test) bisa lanjut mengirim request sebelum Redis benar-
      // benar ready, sehingga isReady() masih false walau Redis sebenarnya
      // hidup. Sekarang init() menunggu event 'ready' ATAU 'error' dulu
      // (timeout 5s sebagai jaring pengaman kalau Redis tidak terjangkau
      // sama sekali) sebelum resolve, supaya status isConnected sudah
      // settle begitu init() selesai.
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, 5000);
        this.client!.once('ready', () => {
          clearTimeout(timeout);
          resolve();
        });
        this.client!.once('error', () => {
          clearTimeout(timeout);
          resolve();
        });
      });
    } catch (err) {
      logger.error('Failed to initialize Redis client: %s', (err as Error).message || err);
      this.isConnected = false;
    }
  }

  public static getClient(): Redis | null {
    return this.client;
  }

  // ──────────────────────────────────────────────────────────────────
  // 🔥 BASIC OPERATIONS
  // ──────────────────────────────────────────────────────────────────

  public static async get(key: string): Promise<string | null> {
    if (this.isConnected && this.client) {
      try {
        return await this.client.get(key);
      } catch (err) {
        logger.error(`Error getting key ${key} from Redis: %s`, (err as Error).message);
      }
    }
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
    const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : null;
    this.inMemoryCache.set(key, { value, expiresAt });
  }

  public static async setex(key: string, seconds: number, value: string): Promise<void> {
    if (this.isConnected && this.client) {
      try {
        await this.client.setex(key, seconds, value);
        return;
      } catch (err) {
        logger.error(`Error setex key ${key} in Redis: %s`, (err as Error).message);
      }
    }
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

  public static async keys(pattern: string): Promise<string[]> {
    if (this.isConnected && this.client) {
      try {
        return await this.client.keys(pattern);
      } catch (err) {
        logger.error(`Error getting keys with pattern ${pattern} from Redis: %s`, (err as Error).message);
        return [];
      }
    }
    const result: string[] = [];
    const regex = new RegExp(pattern.replace(/\*/g, '.*'));
    for (const key of this.inMemoryCache.keys()) {
      if (regex.test(key)) {
        result.push(key);
      }
    }
    return result;
  }

  public static async expire(key: string, seconds: number): Promise<number> {
    if (this.isConnected && this.client) {
      try {
        return await this.client.expire(key, seconds);
      } catch (err) {
        logger.error(`Error expire key ${key} in Redis: %s`, (err as Error).message);
        return 0;
      }
    }
    const item = this.inMemoryCache.get(key);
    if (item) {
      item.expiresAt = Date.now() + seconds * 1000;
      return 1;
    }
    return 0;
  }

  // ──────────────────────────────────────────────────────────────────
  // 🔥 SET OPERATIONS (untuk multi-device driver)
  // ──────────────────────────────────────────────────────────────────

  public static async sadd(key: string, value: string): Promise<number> {
    if (this.isConnected && this.client) {
      try {
        return await this.client.sadd(key, value);
      } catch (err) {
        logger.error(`Error sadd key ${key} in Redis: %s`, (err as Error).message);
        return 0;
      }
    }
    if (!this.inMemorySets.has(key)) {
      this.inMemorySets.set(key, new Set());
    }
    const set = this.inMemorySets.get(key)!;
    set.add(value);
    return set.size;
  }

  public static async srem(key: string, value: string): Promise<number> {
    if (this.isConnected && this.client) {
      try {
        return await this.client.srem(key, value);
      } catch (err) {
        logger.error(`Error srem key ${key} in Redis: %s`, (err as Error).message);
        return 0;
      }
    }
    const set = this.inMemorySets.get(key);
    if (set) {
      const deleted = set.delete(value) ? 1 : 0;
      if (set.size === 0) {
        this.inMemorySets.delete(key);
      }
      return deleted;
    }
    return 0;
  }

  public static async smembers(key: string): Promise<string[]> {
    if (this.isConnected && this.client) {
      try {
        return await this.client.smembers(key);
      } catch (err) {
        logger.error(`Error smembers key ${key} in Redis: %s`, (err as Error).message);
        return [];
      }
    }
    const set = this.inMemorySets.get(key);
    return set ? Array.from(set) : [];
  }

  public static async scard(key: string): Promise<number> {
    if (this.isConnected && this.client) {
      try {
        return await this.client.scard(key);
      } catch (err) {
        logger.error(`Error scard key ${key} in Redis: %s`, (err as Error).message);
        return 0;
      }
    }
    const set = this.inMemorySets.get(key);
    return set ? set.size : 0;
  }

  // ──────────────────────────────────────────────────────────────────
  // 🔥 GEO SPATIAL OPERATIONS (untuk nearest driver)
  // ──────────────────────────────────────────────────────────────────

  public static async geoadd(key: string, longitude: number, latitude: number, member: string): Promise<number> {
    if (this.isConnected && this.client) {
      try {
        return await this.client.geoadd(key, longitude, latitude, member);
      } catch (err) {
        logger.error(`Error geoadd key ${key}:`, err);
        return 0;
      }
    }
    if (!this.inMemoryGeo.has(key)) {
      this.inMemoryGeo.set(key, new Map());
    }
    const geoMap = this.inMemoryGeo.get(key)!;
    geoMap.set(member, { longitude, latitude, timestamp: Date.now() });
    return 1;
  }

  public static async geosearch(
    key: string,
    longitude: number,
    latitude: number,
    radius: number,
    unit: 'km' | 'm' = 'km'
  ): Promise<Array<{ member: string; distance: number }>> {
    if (this.isConnected && this.client) {
      try {
        // ioredis geosearch syntax yang benar
        const results = await this.client.sendCommand(
          new Redis.Command('GEOSEARCH', [
            key,
            'FROMLONLAT',
            longitude.toString(),
            latitude.toString(),
            'BYRADIUS',
            radius.toString(),
            unit,
            'WITHDIST',
            'ASC'
          ])
        ) as any[];

        return results.map((item: any) => {
          if (Array.isArray(item) && item.length === 2) {
            return {
              member: item[0] as string,
              distance: parseFloat(item[1]),
            };
          }
          return { member: '', distance: 0 };
        }).filter((item: any) => item.member !== '');
      } catch (err) {
        logger.error(`Error geosearch key ${key}:`, err);
        return [];
      }
    }

    // Fallback: in-memory Geo search (O(N) - hanya untuk development)
    const geoMap = this.inMemoryGeo.get(key);
    if (!geoMap || geoMap.size === 0) return [];

    const results: Array<{ member: string; distance: number }> = [];
    const R = 6371;
    const toRad = (deg: number) => deg * Math.PI / 180;

    for (const [member, loc] of geoMap) {
      const dLat = toRad(loc.latitude - latitude);
      const dLon = toRad(loc.longitude - longitude);
      const a = Math.sin(dLat/2)**2 + 
                Math.cos(toRad(latitude)) * Math.cos(toRad(loc.latitude)) * 
                Math.sin(dLon/2)**2;
      const distance = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      
      const distanceInUnit = unit === 'km' ? distance : distance * 1000;
      if (distanceInUnit <= radius) {
        results.push({ member, distance: distanceInUnit });
      }
    }

    results.sort((a, b) => a.distance - b.distance);
    return results;
  }

  public static async geopos(key: string, member: string): Promise<[number, number][]> {
    if (this.isConnected && this.client) {
      try {
        const result = await this.client.geopos(key, member);
        if (!result || !result[0]) return [];
        const pos = result[0];
        if (!pos || pos.length < 2) return [];
        return [[parseFloat(pos[0] as string), parseFloat(pos[1] as string)]];
      } catch (err) {
        logger.error(`Error geopos key ${key}:`, err);
        return [];
      }
    }
    const geoMap = this.inMemoryGeo.get(key);
    if (!geoMap) return [];
    const loc = geoMap.get(member);
    if (!loc) return [];
    return [[loc.longitude, loc.latitude]];
  }

  public static async zrem(key: string, member: string): Promise<number> {
    if (this.isConnected && this.client) {
      try {
        return await this.client.zrem(key, member);
      } catch (err) {
        logger.error(`Error zrem key ${key}:`, err);
        return 0;
      }
    }
    const geoMap = this.inMemoryGeo.get(key);
    if (geoMap) {
      return geoMap.delete(member) ? 1 : 0;
    }
    return 0;
  }

  // ──────────────────────────────────────────────────────────────────
  // 🔥 PUB/SUB
  // ──────────────────────────────────────────────────────────────────

  public static async publish(channel: string, message: string): Promise<void> {
    if (this.isConnected && this.client) {
      try {
        await this.client.publish(channel, message);
      } catch (err) {
        logger.error(`Error publishing to channel ${channel}: %s`, (err as Error).message);
      }
    }
  }

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

  // ──────────────────────────────────────────────────────────────────
  // 🔥 UTILITY
  // ──────────────────────────────────────────────────────────────────

  public static async delPattern(pattern: string): Promise<void> {
    const keys = await this.keys(pattern);
    if (keys.length > 0) {
      for (const key of keys) {
        await this.del(key);
      }
      logger.info(`Deleted ${keys.length} keys with pattern: ${pattern}`);
    }
  }

  public static isReady(): boolean {
    return this.isConnected;
  }

  public static clearMemoryCache(): void {
    this.inMemoryCache.clear();
    this.inMemorySets.clear();
    this.inMemoryGeo.clear();
  }
}