import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { AuthRepository } from './auth.repository';
import { logger } from '../../config/logger';
import { ENV } from '../../config/env';
import { AppError } from '../../core/errors/AppError';

export class AuthService {
  private authRepository = new AuthRepository();

  async registerUser(data: {
    email: string;
    passwordPlain: string;
    fullName: string;
    role: 'CUSTOMER' | 'DRIVER' | 'ADMIN' | 'MERCHANT';
    vehiclePlate?: string;
    vehicleModel?: string;
    driverServiceType?: 'BIKE' | 'CAR' | 'SEND';
    merchantName?: string;
    merchantCategory?: string;
    merchantAddress?: string;
    merchantLatitude?: number;
    merchantLongitude?: number;
  }) {
    logger.info(`Registering new user: ${data.email} with role: ${data.role}`);
    const existing = await this.authRepository.findByEmail(data.email);
    if (existing) {
      throw new AppError('Alamat email sudah terdaftar di sistem DHUKNOO!', 400);
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(data.passwordPlain, salt);

    const user = await this.authRepository.createUser({
      email: data.email,
      passwordHash,
      fullName: data.fullName,
      role: data.role as any,
      vehiclePlate: data.vehiclePlate,
      vehicleModel: data.vehicleModel,
      driverServiceType: data.driverServiceType,
      merchantName: data.merchantName,
      merchantCategory: data.merchantCategory,
      merchantAddress: data.merchantAddress,
      merchantLatitude: data.merchantLatitude,
      merchantLongitude: data.merchantLongitude,
    });

    return { id: user.id, email: user.email, role: user.role };
  }

  async loginUser(email: string, passwordPlain: string) {
    logger.info(`Login attempt for user: ${email}`);
    const user = await this.authRepository.findByEmail(email);
    if (!user) {
      throw new AppError('User tidak ditemukan!', 404);
    }

    const isValid = await bcrypt.compare(passwordPlain, user.passwordHash);
    if (!isValid) {
      throw new AppError('Password salah!', 401);
    }

    // Generate tokens using env configuration
    const accessToken = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      ENV.JWT_SECRET,
      { expiresIn: '15m' }
    );

    const refreshToken = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      ENV.JWT_REFRESH_SECRET,
      { expiresIn: '7d' }
    );

    // Save refresh token to DB
    await this.authRepository.updateRefreshToken(user.id, refreshToken);

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
      },
    };
  }

  async handleRefreshToken(token: string) {
    try {
      const decoded = jwt.verify(token, ENV.JWT_REFRESH_SECRET) as any;
      const user = await this.authRepository.findById(decoded.id);

      if (!user || user.refreshToken !== token) {
        throw new AppError('Token refresh tidak valid!', 403);
      }

      const accessToken = jwt.sign(
        { id: user.id, email: user.email, role: user.role },
        ENV.JWT_SECRET,
        { expiresIn: '15m' }
      );

      return { accessToken };
    } catch (err) {
      logger.error('Error during token refresh exchange: %s', (err as Error).message || err);
      throw new AppError('Autentikasi gagal. Sesi Anda kedaluwarsa!', 401);
    }
  }

  async changePassword(userId: string, oldPlain: string, newPlain: string) {
    logger.info(`Password change requested for user id: ${userId}`);
    const user = await this.authRepository.findById(userId);
    if (!user) {
      throw new AppError('User tidak ditemukan!', 404);
    }

    const isValid = await bcrypt.compare(oldPlain, user.passwordHash);
    if (!isValid) {
      throw new AppError('Password lama salah!', 400);
    }

    if (newPlain.length < 4) {
      throw new AppError('Password baru minimal 4 karakter!', 400);
    }

    const salt = await bcrypt.genSalt(10);
    const newHash = await bcrypt.hash(newPlain, salt);

    await this.authRepository.updateAdminPassword(userId, newHash);
    logger.info(`Password updated successfully for user id: ${userId}`);
    return true;
  }
}
