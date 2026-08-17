// core/middleware/requestId.middleware.ts
//
// 🆕 FIX P0 "Investigasi GET /jobs yang sempat 500; tambahkan
// correlation/request ID dan logging terstruktur" (audit driver-jobs).
// SEBELUMNYA tidak ada satu pun mekanisme untuk menghubungkan satu
// baris log error di server dengan satu request tertentu dari client --
// kalau ada laporan "GET /jobs sempat 500 tadi jam sekian", satu-satunya
// cara mencarinya di log adalah menebak-nebak berdasarkan waktu & path,
// yang tidak reliable begitu traffic lebih dari satu user bersamaan.
//
// Middleware ini:
//   1. Memakai header `X-Request-Id` dari client kalau ada (mis. dikirim
//      mobile app supaya bisa dicocokkan dengan log sisi client), atau
//      generate UUID baru kalau tidak ada.
//   2. Menempelkannya ke `req.requestId` supaya semua handler/service di
//      bawahnya bisa memakainya.
//   3. Menyediakan `req.log` -- child logger Pino yang OTOMATIS menyertakan
//      requestId di setiap baris log tanpa perlu diketik ulang manual di
//      setiap tempat (lihat penggunaannya di job.routes.ts).
//   4. Mengembalikan header `X-Request-Id` yang SAMA di response, supaya
//      client bisa menyertakannya saat melaporkan bug ("request ID: ...").

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { logger } from '../../config/logger';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
      log: typeof logger;
    }
  }
}

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction) {
  const incoming = req.header('x-request-id');
  const requestId = incoming && incoming.trim().length > 0 ? incoming.trim() : crypto.randomUUID();

  req.requestId = requestId;
  req.log = logger.child({ requestId });
  res.setHeader('X-Request-Id', requestId);

  next();
}
