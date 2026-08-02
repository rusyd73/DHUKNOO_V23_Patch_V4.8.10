export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;

  constructor(message: string, statusCode = 400, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    Object.setPrototypeOf(this, new.target.prototype);
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 400);
  }
}

export class AuthenticationError extends AppError {
  constructor(message = 'Autentikasi gagal atau tidak sah!') {
    super(message, 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Akses ditolak. Peran Anda tidak diizinkan melakukan aksi ini.') {
    super(message, 403);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Sumber daya tidak ditemukan!') {
    super(message, 404);
  }
}
