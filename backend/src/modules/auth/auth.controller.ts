import { Response } from 'express';
import { AuthenticatedRequest } from '../../core/middleware/auth.middleware';
import { AuthService } from './auth.service';
import { logger } from '../../config/logger';
import { AuditLogger } from '../../core/logging/audit.logger';
import { QueueService } from '../../jobs/bullmq';
import { AppError } from '../../core/errors/AppError';

export class AuthController {
  private authService = new AuthService();

  register = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const {
        email, password, fullName, role, vehiclePlate, vehicleModel, driverServiceType,
        merchantName, merchantCategory, merchantAddress, merchantLatitude, merchantLongitude,
      } = req.body;

      // ✅ PERBAIKAN 1: Normalize email
      const normalizedEmail = email?.toLowerCase().trim();

      const result = await this.authService.registerUser({
        email: normalizedEmail, // ✅ Pakai email yang sudah dinormalisasi
        passwordPlain: password,
        fullName,
        role,
        vehiclePlate,
        vehicleModel,
        driverServiceType,
        merchantName,
        merchantCategory,
        merchantAddress,
        merchantLatitude,
        merchantLongitude,
      });

      await AuditLogger.log(result.id, 'USER_REGISTER', `Akun terdaftar dengan peran: ${role}`);

      await QueueService.addNotificationJob(
        result.id,
        'Registrasi Akun Berhasil!',
        `Selamat bergabung di DHUKNOO Ride, ${fullName}! Nikmati perjalanan aman Malang-Batu.`
      );

      return res.status(201).json({ message: 'Registrasi akun DHUKNOO berhasil!', user: result });
    } catch (err: any) {
      logger.error('Registration controller error: %s', err.message);
      const status = err instanceof AppError ? err.statusCode : 400;
      return res.status(status).json({ error: err.message });
    }
  };

  login = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { email, password } = req.body;

      // ✅ Normalize email
      const normalizedEmail = email?.toLowerCase().trim();

      // ✅ Validasi input
      if (!normalizedEmail || !password) {
        return res.status(400).json({ 
          error: 'Email dan password wajib diisi!' 
        });
      }

      // ✅ Panggil service dengan email yang sudah dinormalisasi
      const result = await this.authService.loginUser(normalizedEmail, password);

      logger.info(`✅ Login successful: userId=${result.user.id} role=${result.user.role}`);

      // Write Audit Log
      await AuditLogger.log(result.user.id, 'USER_LOGIN', `User ${normalizedEmail} masuk sistem.`);

      return res.status(200).json(result);
    } catch (err: any) {
      logger.error('❌ Login controller error: %s', err.message);
      const status = err instanceof AppError ? err.statusCode : 401;
      return res.status(status).json({ error: err.message });
    }
  };

  refresh = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { refreshToken } = req.body;
      if (!refreshToken) {
        return res.status(400).json({ error: 'Refresh token wajib diisi!' });
      }
      const result = await this.authService.handleRefreshToken(refreshToken);
      return res.status(200).json(result);
    } catch (err: any) {
      logger.error('Refresh token controller error: %s', err.message);
      return res.status(403).json({ error: err.message });
    }
  };

  changePassword = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: 'Pengguna tidak terautentikasi!' });
      }
      const { oldPassword, newPassword } = req.body;
      await this.authService.changePassword(userId, oldPassword, newPassword);

      await AuditLogger.log(userId, 'USER_PASSWORD_CHANGE', `Mengganti kata sandi.`);

      return res.status(200).json({ message: 'Password berhasil diperbarui!' });
    } catch (err: any) {
      logger.error('Change password controller error: %s', err.message);
      const status = err instanceof AppError ? err.statusCode : 400;
      return res.status(status).json({ error: err.message });
    }
  };

  // 🆕 PERBAIKAN #1 — Lupa/Reset Password (Langkah 1: minta kode reset)
  requestPasswordReset = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { phone, email, emailOrPhone } = req.body;
      const identifier = emailOrPhone || email || phone;

      const result = await this.authService.requestPasswordReset(identifier);

      return res.status(200).json(result);
    } catch (err: any) {
      logger.error('Request password reset controller error: %s', err.message);
      const status = err instanceof AppError ? err.statusCode : 400;
      return res.status(status).json({ error: err.message });
    }
  };

  // 🆕 PERBAIKAN #1 — Lupa/Reset Password (Langkah 2: konfirmasi kode + password baru)
  confirmPasswordReset = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { token, newPassword } = req.body;
      const { userId, ...result } = await this.authService.confirmPasswordReset(token, newPassword);

      await AuditLogger.log(userId, 'USER_PASSWORD_RESET', 'Password direset lewat alur lupa password.');

      return res.status(200).json(result);
    } catch (err: any) {
      logger.error('Confirm password reset controller error: %s', err.message);
      const status = err instanceof AppError ? err.statusCode : 400;
      return res.status(status).json({ error: err.message });
    }
  };

  // 🆕 LOGOUT — cabut refresh token server-side.
  logout = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: 'Pengguna tidak terautentikasi!' });
      }
      const result = await this.authService.logout(userId);
      await AuditLogger.log(userId, 'USER_LOGOUT', 'User keluar dari sesi.');
      return res.status(200).json(result);
    } catch (err: any) {
      logger.error('Logout controller error: %s', err.message);
      return res.status(500).json({ error: 'Gagal keluar dari sesi.' });
    }
  };

  getProfile = async (req: AuthenticatedRequest, res: Response) => {
    try {
      return res.status(200).json({
        user: req.user,
        message: 'Akses profil berhasil terverifikasi via Role Based Access Control',
      });
    } catch (err: any) {
      return res.status(500).json({ error: 'Internal server error' });
    }
  };
}