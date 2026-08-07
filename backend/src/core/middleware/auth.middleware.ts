import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { logger } from '../../config/logger';
import { ENV } from '../../config/env';
import { AuthenticationError, ForbiddenError } from '../errors/AppError';
import { prisma } from '../../config/prisma';
import { RedisService } from '../../config/redis';

const ACTIVE_STATUS_CACHE_PREFIX = 'auth:isActive:';
const ACTIVE_STATUS_CACHE_TTL_SECONDS = 30;

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: 'CUSTOMER' | 'DRIVER' | 'ADMIN' | 'MERCHANT';
  };
}

export const authenticateToken = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    logger.warn(`Unauthenticated request access denied on path: ${req.path}`);
    return res.status(401).json({ error: 'Akses ditolak. Token autentikasi kosong!' });
  }

  jwt.verify(token, ENV.JWT_SECRET, async (err, decoded) => {
    if (err) {
      logger.error(`Invalid JWT token attempt on path: ${req.path}`);
      // PERBAIKAN: sebelumnya balas 403 di sini. Token EXPIRED itu situasi
      // NORMAL (bukan "dilarang") dan HARUS berstatus 401 Unauthorized, BUKAN
      // 403 Forbidden -- lagipula interceptor refresh-token di frontend
      // (apiClient.ts) HANYA memicu percobaan refresh otomatis saat melihat
      // status 401. Selama endpoint ini balas 403, token yang kedaluwarsa
      // (kejadian wajar tiap beberapa saat) TIDAK PERNAH memicu refresh sama
      // sekali -- user langsung mentok error 403 di request APA PUN
      // (termasuk /api/wallet/topup & /api/upload/image yang dilaporkan)
      // sampai logout & login manual.
      return res.status(401).json({ error: 'Token kedaluwarsa atau tidak valid!' });
    }

    const payload = decoded as AuthenticatedRequest['user'];

    // 🆕 PERBAIKAN #3 (revisi): kalau admin menonaktifkan akun user SEMENTARA
    // access token lamanya masih berlaku, request berikutnya tetap harus
    // ditolak. TAPI versi awal perbaikan ini melakukan SATU query DB penuh
    // (prisma.user.findUnique) pada SETIAP SATU request terautentikasi di
    // SELURUH aplikasi -- termasuk polling GPS driver, polling daftar order,
    // riwayat chat, dst. Di produksi ini menambah latensi + beban DB yang
    // konsisten di jalur tercepat sekalipun, dan persis pola gejala yang
    // dilaporkan (auto-accept/notifikasi ring jadi terasa tidak realtime,
    // beberapa request "hilang"/timeout) -- terutama saat DB sedang sedikit
    // lambat. Sekarang status isActive di-cache lewat Redis (fallback
    // in-memory kalau Redis tidak dikonfigurasi) selama 30 detik per user,
    // supaya jalur request normal TIDAK query DB sama sekali di request
    // ke-2 dst. Saat admin men-deactivate/reactivate user (lihat
    // admin.routes.ts), cache ini langsung dihapus supaya efeknya tetap
    // terasa dalam hitungan detik, bukan menunggu TTL habis.
    try {
      const cacheKey = `${ACTIVE_STATUS_CACHE_PREFIX}${payload!.id}`;
      const cached = await RedisService.get(cacheKey);

      let isActive: boolean;
      if (cached !== null) {
        isActive = cached === '1';
      } else {
        const dbUser = await prisma.user.findUnique({
          where: { id: payload!.id },
          select: { isActive: true },
        });

        if (!dbUser) {
          return res.status(401).json({ error: 'Akun tidak ditemukan.' });
        }

        isActive = dbUser.isActive !== false;
        await RedisService.set(cacheKey, isActive ? '1' : '0', ACTIVE_STATUS_CACHE_TTL_SECONDS);
      }

      if (!isActive) {
        logger.warn(`⛔ Access denied — account deactivated: ${payload!.id}`);
        return res.status(403).json({
          error: 'Akun Anda telah dinonaktifkan oleh Admin. Hubungi Customer Service DHUKNOO untuk aktivasi kembali.',
        });
      }
    } catch (dbErr: any) {
      logger.error('Gagal memeriksa status akun (isActive) saat autentikasi: %s', dbErr.message || dbErr);
      // Jangan blokir request hanya karena pengecekan ini gagal (mis. DB/Redis
      // sesaat tidak responsif) — kegagalan nyata tetap tertangkap di layer bawahnya.
    }

    req.user = payload;
    next();
  });
};

export const authorizeRoles = (...allowedRoles: ('CUSTOMER' | 'DRIVER' | 'ADMIN' | 'MERCHANT')[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Akses tidak sah. Pengguna tidak teridentifikasi!' });
    }

    if (!allowedRoles.includes(req.user.role)) {
      logger.warn(`Forbidden role access attempt. User ${req.user.email} with role ${req.user.role} tried to access restricted action.`);
      return res.status(403).json({
        error: `Akses ditolak. Peran Anda (${req.user.role}) tidak diizinkan melakukan aksi ini.`,
      });
    }

    next();
  };
};
