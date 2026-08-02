import { Response } from 'express';

export class ApiResponse {
  public static success<T>(res: Response, message: string, data?: T, statusCode = 200) {
    return res.status(statusCode).json({
      success: true,
      message,
      data,
    });
  }

  public static error(res: Response, message: string, statusCode = 400, details?: any) {
    return res.status(statusCode).json({
      success: false,
      error: message,
      details,
    });
  }
}
