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
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    logger.warn(`Unauthenticated request access denied on path: ${req.path}`);
    return res.status(401).json({ error: 'Akses ditolak. Token autentikasi kosong!' });
  }

  jwt.verify(token, ENV.JWT_SECRET, async (err, decoded) => {
    if (err) {
      logger.error(`Invalid JWT token attempt on path: ${req.path}`);
      return res.status(401).json({ error: 'Token kedaluwarsa atau tidak valid!' });
    }

    const payload = decoded as AuthenticatedRequest['user'];

    // ============================================================
    // 🔒 CEK USER AKTIF - FAIL CLOSED
    // ============================================================
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

      // ✅ Set user ke request
      req.user = payload;
      next();

    } catch (dbErr: any) {
      // ✅ FAIL CLOSED: Database/Redis error → tolak request
      logger.error('Gagal memeriksa status akun (isActive) saat autentikasi: %s', dbErr.message || dbErr);
      return res.status(503).json({
        error: 'Service unavailable - Unable to verify authentication status',
        code: 'AUTH_SERVICE_UNAVAILABLE',
      });
    }
  });
};

export const authorizeRoles = (...allowedRoles: ('CUSTOMER' | 'DRIVER' | 'ADMIN' | 'MERCHANT')[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
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

    } catch (err: any) {
      // ✅ FAIL CLOSED: Error → tolak request
      logger.error('Authorize roles error:', err);
      return res.status(503).json({
        error: 'Service unavailable - Unable to verify authorization',
        code: 'AUTH_SERVICE_UNAVAILABLE',
      });
    }
  };
};

// ============================================================
// 🆕 FIX P1 "Logout pernah 401 tanpa auth; pastikan logout
// idempotent/ditangani saat token sudah invalid" (audit driver-jobs).
// Middleware TOLERAN -- kalau access token ADA dan valid, isi req.user
// (sama seperti authenticateToken). Kalau TIDAK ADA atau tidak valid
// (kedaluwarsa, malformed, dst), JANGAN tolak request -- lanjutkan saja
// dengan req.user tetap undefined. Dipakai KHUSUS untuk endpoint yang
// harus tetap bisa diproses dengan aman tanpa access token yang masih
// hidup (logout adalah contoh utamanya -- lihat auth.controller.ts).
// TIDAK dipakai untuk endpoint yang benar-benar butuh identitas user
// (pakai authenticateToken biasa untuk itu).
// ============================================================
export const optionalAuthenticateToken = (
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return next();
  }

  jwt.verify(token, ENV.JWT_SECRET, (err, decoded) => {
    if (!err && decoded) {
      req.user = decoded as AuthenticatedRequest['user'];
    }
    // Token tidak valid/kedaluwarsa -> diam-diam lanjut TANPA req.user,
    // bukan 401. Sengaja TIDAK melakukan cek isActive/Redis di sini
    // (beda dengan authenticateToken) karena tujuan middleware ini
    // murni "identifikasi kalau bisa", bukan gerbang otorisasi.
    next();
  });
};