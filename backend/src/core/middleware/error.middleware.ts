import { Request, Response, NextFunction } from 'express';
import { logger } from '../../config/logger';
import { AppError } from '../errors/AppError';
import { ApiResponse } from '../response/ApiResponse';

export const errorHandler = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  // If headers already sent, delegate to default express error handler
  if (res.headersSent) {
    return next(err);
  }

  const statusCode = err instanceof AppError ? err.statusCode : 500;
  const message = err.message || 'Terjadi kesalahan sistem internal.';
  // 🆕 FIX P0 "correlation/request ID dan logging terstruktur" (audit
  // driver-jobs): requestId (dari requestId.middleware.ts, dipasang
  // sedini mungkin di app.ts) disertakan di BAIK log server MAUPUN
  // response ke client -- supaya satu insiden 500 bisa dilacak dari
  // laporan user ("request ID: xxx") langsung ke baris log yang persis
  // sama, tanpa menebak-nebak berdasarkan waktu/path saja.
  const requestId = (req as any).requestId;

  (req.log || logger).error({
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    requestId,
  }, 'Error caught in error middleware:');

  // Format exactly what the user's old endpoints return (which is { error: message })
  // and we can enrich it if we want. Let's make sure it returns `{ error: message }` to match the exact output expected.
  return res.status(statusCode).json({ error: message, requestId });
};
