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

  logger.error({
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  }, 'Error caught in error middleware:');

  // Format exactly what the user's old endpoints return (which is { error: message })
  // and we can enrich it if we want. Let's make sure it returns `{ error: message }` to match the exact output expected.
  return res.status(statusCode).json({ error: message });
};
