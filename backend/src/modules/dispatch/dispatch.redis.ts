// modules/dispatch/dispatch.redis.ts
import { RedisService } from '../../config/redis';
import { logger } from '../../config/logger';

// 🆕 FIX "Redis architecture" -- KONSOLIDASI KE SATU KONEKSI (audit
// lanjutan, menuntaskan catatan yang sebelumnya cuma didokumentasikan):
// SEBELUMNYA modul ini bikin koneksi Redis SENDIRI (`new Redis(REDIS_URL)`),
// terpisah total dari RedisService (config/redis.ts) yang jadi "koneksi
// resmi" app -- DUA koneksi/connection-pool independen ke Redis yang
// sama, boros resource, dan tidak saling terhubung status
// connect/disconnect-nya.
//
// Sekarang dikonsolidasi memakai RedisService.getClient() -- SATU
// koneksi ioredis yang sama dipakai seluruh app (sudah py listener
// 'error' & retryStrategy sendiri, jadi tidak perlu duplikasi lagi
// di sini).
//
// TAPI SENGAJA TIDAK memakai method wrapper RedisService (get/set/dst)
// yang PUNYA fallback in-memory otomatis kalau Redis down -- dispatch
// lock WAJIB benar-benar atomik LINTAS INSTANCE; fallback in-memory
// PER-INSTANCE justru akan merusak jaminan mutual-exclusion-nya di
// deployment multi-instance (dua instance beda bisa sama-sama
// "berhasil" acquire lock yang harusnya saling meniadakan kalau
// masing-masing diam-diam fallback ke memory lokalnya sendiri).
// getRedisOrThrow() di bawah mengambil client MENTAH dari
// RedisService.getClient() dan memanggil command Redis langsung di
// atasnya -- kalau Redis benar-benar tidak terhubung, method-method di
// bawah GAGAL EKSPLISIT (throw), BUKAN diam-diam "berhasil" pakai
// memori lokal yang salah secara semantik untuk use-case ini.
function getRedisOrThrow() {
  // 🆕 FIX P0/P1 "Redis readiness" (audit): SEBELUMNYA fungsi ini HANYA
  // mengecek `RedisService.getClient()` tidak null -- tapi client ioredis
  // TETAP non-null (objek instance-nya tetap ada) bahkan ketika koneksi
  // benar-benar putus (setelah event 'error', sebelum reconnect berhasil,
  // atau sebelum event 'connect' pertama sama sekali). ioredis defaultnya
  // BUFFER command saat disconnected dan baru mengirim setelah reconnect
  // -- artinya operasi dispatch lock/state DIAM-DIAM ANTRE alih-alih
  // gagal cepat, memberi ILUSI dispatch sehat (request tidak error, tapi
  // juga tidak benar-benar selesai tepat waktu) persis yang diperingatkan
  // audit P0 #9 ("service tidak boleh diam-diam berjalan dalam mode yang
  // memberikan ilusi dispatch sehat").
  //
  // RedisService.isReady() melacak status KONEKSI SUNGGUHAN lewat event
  // 'connect'/'error' (lihat config/redis.ts) -- sekarang WAJIB true
  // juga, bukan cuma client-nya ada. Kalau Redis belum/tidak ready,
  // gagal EKSPLISIT SEKARANG JUGA (fail-closed) alih-alih menunggu buffer
  // command ioredis yang tidak terlihat dari luar.
  if (!RedisService.isReady()) {
    throw new Error('[DispatchRedis] Redis belum/tidak ready (readiness check gagal) -- operasi dispatch (lock/state) tidak bisa dijamin atomik lintas instance tanpa Redis yang benar-benar terhubung. Menolak beroperasi daripada diam-diam salah.');
  }
  const client = RedisService.getClient();
  if (!client) {
    throw new Error('[DispatchRedis] Redis tidak terhubung -- operasi dispatch (lock/state) tidak bisa dijamin atomik lintas instance tanpa Redis. Menolak beroperasi daripada diam-diam salah.');
  }
  return client;
}

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
    await getRedisOrThrow().setex(key, DISPATCH_TTL, JSON.stringify({
      orderId,
      driverIds,
      currentIndex: 0,
      status: 'DISPATCHING',
      startedAt: new Date().toISOString(),
    }));
  }

  static async getDispatchState(orderId: string): Promise<any> {
    const key = `${PREFIX}${orderId}`;
    const data = await getRedisOrThrow().get(key);
    return data ? JSON.parse(data) : null;
  }

  static async updateDispatchState(orderId: string, updates: any): Promise<void> {
    const key = `${PREFIX}${orderId}`;
    const current = await this.getDispatchState(orderId);
    if (!current) return;
    await getRedisOrThrow().setex(key, DISPATCH_TTL, JSON.stringify({ ...current, ...updates }));
  }

  static async clearDispatchState(orderId: string): Promise<void> {
    await getRedisOrThrow().del(`${PREFIX}${orderId}`);
  }

  static async setCurrentDriver(orderId: string, driverId: string): Promise<void> {
    await getRedisOrThrow().setex(`${OFFER_PREFIX}${orderId}`, OFFER_TTL, driverId);
  }

  static async getCurrentDriver(orderId: string): Promise<string | null> {
    return getRedisOrThrow().get(`${OFFER_PREFIX}${orderId}`);
  }

  static async clearCurrentDriver(orderId: string): Promise<void> {
    await getRedisOrThrow().del(`${OFFER_PREFIX}${orderId}`);
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
    const result = await getRedisOrThrow().set(key, 'locked', 'EX', LOCK_TTL, 'NX');
    return result === 'OK';
  }

  static async releaseLock(orderId: string): Promise<void> {
    await getRedisOrThrow().del(`${LOCK_PREFIX}${orderId}`);
  }

  static async setDriverBusy(driverId: string, orderId: string): Promise<void> {
    await getRedisOrThrow().setex(`${DRIVER_PREFIX}${driverId}`, DRIVER_BUSY_TTL, orderId);
  }

  static async getDriverBusy(driverId: string): Promise<string | null> {
    return getRedisOrThrow().get(`${DRIVER_PREFIX}${driverId}`);
  }

  static async clearDriverBusy(driverId: string): Promise<void> {
    await getRedisOrThrow().del(`${DRIVER_PREFIX}${driverId}`);
  }

  static async scheduleTimeout(orderId: string, delaySeconds: number): Promise<void> {
    await getRedisOrThrow().setex(`${TIMEOUT_PREFIX}${orderId}`, delaySeconds, 'pending');
  }

  static async checkTimeout(orderId: string): Promise<boolean> {
    return (await getRedisOrThrow().exists(`${TIMEOUT_PREFIX}${orderId}`)) === 1;
  }

  static async cancelTimeout(orderId: string): Promise<void> {
    await getRedisOrThrow().del(`${TIMEOUT_PREFIX}${orderId}`);
  }

  static async recoverPendingDispatches(): Promise<string[]> {
    const keys = await getRedisOrThrow().keys(`${PREFIX}*`);
    return keys.map(k => k.replace(PREFIX, ''));
  }
}