// modules/dispatch/dispatch.redis.ts
import Redis from 'ioredis';
import { logger } from '../../config/logger';

// 🆕 CATATAN "Redis architecture" (audit lanjutan, belum sepenuhnya
// diselesaikan di sini -- didokumentasikan sebagai known limitation):
// modul ini bikin koneksi Redis SENDIRI, terpisah total dari
// RedisService (config/redis.ts) yang jadi "koneksi resmi" app --
// dua koneksi independen ke Redis yang sama, tidak saling terhubung.
// RedisService py fallback in-memory otomatis kalau Redis down;
// koneksi di sini TIDAK -- karena dispatch lock WAJIB benar-benar
// atomik lintas instance (fallback in-memory PER-INSTANCE justru akan
// merusak jaminan mutual-exclusion-nya kalau dipakai multi-instance --
// dua instance beda bisa sama-sama "berhasil" acquire lock yang
// harusnya saling meniadakan kalau masing-masing fallback ke memory
// lokalnya sendiri). Konsolidasi penuh ke RedisService (menambahkan
// method atomic-lock & JSON helpers di sana) adalah perbaikan lanjutan
// yang direkomendasikan, di luar scope perbaikan kritis sesi ini.
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const redis = new Redis(REDIS_URL);

// 🆕 FIX KRITIS "Redis architecture" -- STABILITAS PRODUKSI:
// SEBELUMNYA tidak ada listener 'error' sama sekali di client ini.
// Node.js EventEmitter (dasar ioredis) akan THROW UNCAUGHT EXCEPTION
// dan BISA MENJATUHKAN SELURUH PROSES NODE kalau event 'error' terjadi
// tanpa ada listener terpasang -- artinya gangguan koneksi Redis
// SEKECIL APAPUN (restart Redis, network blip sesaat) berpotensi
// CRASH TOTAL seluruh backend (bukan cuma fitur dispatch), bukan cuma
// gagal dengan graceful degradation. Ditambahkan listener supaya error
// koneksi di-log, bukan menjatuhkan proses.
redis.on('error', (err) => {
  logger.error('[DispatchRedis] Redis connection error: %s', err.message || err);
});

const PREFIX = 'dispatch:';
const LOCK_PREFIX = 'lock:';
const OFFER_PREFIX = 'offer:';
const DRIVER_PREFIX = 'driver:';
const TIMEOUT_PREFIX = 'timeout:';

const DISPATCH_TTL = 300;
const OFFER_TTL = 60;
const LOCK_TTL = 30;
const DRIVER_BUSY_TTL = 300;

export class DispatchRedis {
  static async setDispatchState(orderId: string, driverIds: string[]): Promise<void> {
    const key = `${PREFIX}${orderId}`;
    await redis.setex(key, DISPATCH_TTL, JSON.stringify({
      orderId,
      driverIds,
      currentIndex: 0,
      status: 'DISPATCHING',
      startedAt: new Date().toISOString(),
    }));
  }

  static async getDispatchState(orderId: string): Promise<any> {
    const key = `${PREFIX}${orderId}`;
    const data = await redis.get(key);
    return data ? JSON.parse(data) : null;
  }

  static async updateDispatchState(orderId: string, updates: any): Promise<void> {
    const key = `${PREFIX}${orderId}`;
    const current = await this.getDispatchState(orderId);
    if (!current) return;
    await redis.setex(key, DISPATCH_TTL, JSON.stringify({ ...current, ...updates }));
  }

  static async clearDispatchState(orderId: string): Promise<void> {
    await redis.del(`${PREFIX}${orderId}`);
  }

  static async setCurrentDriver(orderId: string, driverId: string): Promise<void> {
    await redis.setex(`${OFFER_PREFIX}${orderId}`, OFFER_TTL, driverId);
  }

  static async getCurrentDriver(orderId: string): Promise<string | null> {
    return redis.get(`${OFFER_PREFIX}${orderId}`);
  }

  static async clearCurrentDriver(orderId: string): Promise<void> {
    await redis.del(`${OFFER_PREFIX}${orderId}`);
  }

  // 🆕 FIX KRITIS "Redis architecture" -- LOCK TIDAK ATOMIK:
  // SEBELUMNYA acquireLock() memanggil DUA command Redis terpisah:
  // setnx() dulu, baru expire() belakangan. Kalau proses crash /
  // koneksi putus PERSIS di antara kedua panggilan itu (setnx berhasil
  // set key, tapi expire() tidak sempat jalan), lock itu TERSIMPAN
  // TANPA TTL SAMA SEKALI -- tidak akan pernah auto-expire, order
  // tersebut STUCK PERMANEN, tidak akan pernah bisa di-dispatch ulang
  // ke driver manapun sampai ada yang manual hapus key-nya di Redis.
  // Diperbaiki jadi SATU command atomik: SET key value NX EX ttl --
  // set-jika-belum-ada DAN pasang TTL dalam operasi tunggal yang tidak
  // bisa "terputus di tengah".
  static async acquireLock(orderId: string): Promise<boolean> {
    const key = `${LOCK_PREFIX}${orderId}`;
    const result = await redis.set(key, 'locked', 'EX', LOCK_TTL, 'NX');
    return result === 'OK';
  }

  static async releaseLock(orderId: string): Promise<void> {
    await redis.del(`${LOCK_PREFIX}${orderId}`);
  }

  static async setDriverBusy(driverId: string, orderId: string): Promise<void> {
    await redis.setex(`${DRIVER_PREFIX}${driverId}`, DRIVER_BUSY_TTL, orderId);
  }

  static async getDriverBusy(driverId: string): Promise<string | null> {
    return redis.get(`${DRIVER_PREFIX}${driverId}`);
  }

  static async clearDriverBusy(driverId: string): Promise<void> {
    await redis.del(`${DRIVER_PREFIX}${driverId}`);
  }

  static async scheduleTimeout(orderId: string, delaySeconds: number): Promise<void> {
    await redis.setex(`${TIMEOUT_PREFIX}${orderId}`, delaySeconds, 'pending');
  }

  static async checkTimeout(orderId: string): Promise<boolean> {
    return (await redis.exists(`${TIMEOUT_PREFIX}${orderId}`)) === 1;
  }

  static async cancelTimeout(orderId: string): Promise<void> {
    await redis.del(`${TIMEOUT_PREFIX}${orderId}`);
  }

  static async recoverPendingDispatches(): Promise<string[]> {
    const keys = await redis.keys(`${PREFIX}*`);
    return keys.map(k => k.replace(PREFIX, ''));
  }
}

export default redis;