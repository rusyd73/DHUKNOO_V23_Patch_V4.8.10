export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  // 🆕 FIX P0 "Gunakan error code stabil seperti DRIVER_OFFLINE, bukan
  // parsing string pesan" (audit driver-jobs): `code` opsional ini
  // memberi identifier MACHINE-READABLE yang stabil untuk error
  // tertentu (mis. 'DRIVER_OFFLINE'), terpisah dari `message` yang
  // ditujukan untuk dibaca MANUSIA dan boleh berubah kapan saja (typo
  // fix, terjemahan, dst) tanpa merusak logic apa pun yang bergantung
  // padanya. Consumer (frontend, atau catch block lain di backend)
  // harus cek `code`, BUKAN melakukan `message.includes('offline')`
  // yang rapuh terhadap perubahan kata sekecil apa pun.
  public readonly code?: string;

  constructor(message: string, statusCode = 400, isOperational = true, code?: string) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.code = code;
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
