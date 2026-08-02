import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { logger } from '../../config/logger';
import { ENV } from '../../config/env';
import { AuthenticationError, ForbiddenError } from '../errors/AppError';

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

  jwt.verify(token, ENV.JWT_SECRET, (err, decoded) => {
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
    req.user = decoded as AuthenticatedRequest['user'];
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
