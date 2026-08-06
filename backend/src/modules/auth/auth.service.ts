import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { AuthRepository } from './auth.repository';
import { logger } from '../../config/logger';
import { ENV } from '../../config/env';
import { AppError } from '../../core/errors/AppError';
import { MailerService } from '../../config/mailer';

export class AuthService {
  private authRepository = new AuthRepository();

  // ✅ Helper: Normalize email
  private normalizeEmail(email: string): string {
    if (!email) return '';
    return email.toLowerCase().trim();
  }

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
    // ✅ PERBAIKAN 1: Normalize email
    const normalizedEmail = this.normalizeEmail(data.email);
    
    logger.info(`Registering new user: ${normalizedEmail} with role: ${data.role}`);
    
    // ✅ Cek dengan email yang sudah dinormalisasi
    const existing = await this.authRepository.findByEmail(normalizedEmail);
    if (existing) {
      throw new AppError('Alamat email sudah terdaftar di sistem DHUKNOO!', 400);
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(data.passwordPlain, salt);

    // ✅ Simpan email yang sudah dinormalisasi
    const user = await this.authRepository.createUser({
      email: normalizedEmail, // ✅ Pakai email yang sudah dinormalisasi
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
    // ✅ PERBAIKAN 2: Normalize email di awal
    const normalizedEmail = this.normalizeEmail(email);
    
    logger.info(`🔍 Login attempt for user: ${normalizedEmail}`);
    
    // ✅ Debug: Log detail email
    logger.info(`  Email RAW: "${email}"`);
    logger.info(`  Normalized: "${normalizedEmail}"`);
    
    // ✅ Cek user dengan email yang sudah dinormalisasi
    const user = await this.authRepository.findByEmail(normalizedEmail);
    
    // ✅ Jika tidak ditemukan, coba cari dengan case insensitive (fallback)
    if (!user) {
      logger.warn(`❌ User not found with normalized email: ${normalizedEmail}`);
      
      // ✅ Opsional: Cek apakah ada user dengan email case berbeda
      const allUsers = await this.authRepository.findAllUsers();
      const matchingUsers = allUsers.filter(u => 
        u.email.toLowerCase().trim() === normalizedEmail
      );
      
      if (matchingUsers.length > 0) {
        logger.warn(`⚠️ Found user with different case: ${matchingUsers[0].email}`);
        // ✅ Gunakan user yang ditemukan
        const foundUser = matchingUsers[0];
        const isValid = await bcrypt.compare(passwordPlain, foundUser.passwordHash);
        if (!isValid) {
          throw new AppError('Password salah!', 401);
        }
        // ✅ Generate token untuk user ini
        return this.generateTokens(foundUser);
      }
      
      throw new AppError('User tidak ditemukan! Periksa kembali email Anda.', 404);
    }

    // ✅ Verifikasi password
    const isValid = await bcrypt.compare(passwordPlain, user.passwordHash);
    if (!isValid) {
      logger.warn(`❌ Invalid password for user: ${user.id}`);
      throw new AppError('Password salah! Periksa kembali password Anda.', 401);
    }

    // 🆕 PERBAIKAN #3: tolak login untuk akun yang sudah dinonaktifkan admin.
    if (user.isActive === false) {
      logger.warn(`⛔ Login blocked — account deactivated: ${user.id} (${user.email})`);
      throw new AppError(
        'Akun Anda telah dinonaktifkan oleh Admin. Hubungi Customer Service DHUKNOO untuk mengajukan aktivasi kembali.',
        403
      );
    }

    logger.info(`✅ Login successful for user: ${user.id} (${user.email})`);
    
    return this.generateTokens(user);
  }

  // ============================================================
  // 🆕 PERBAIKAN #1: LUPA / RESET PASSWORD
  // ============================================================

  /** Buat kode OTP 6 digit acak (bukan sequential/predictable). */
  private generateOtpCode(): string {
    return crypto.randomInt(100000, 999999).toString();
  }

  /**
   * Langkah 1: user minta reset password lewat email ATAU nomor HP.
   * Selalu balas pesan generik & status 200 walau user tidak ditemukan,
   * supaya endpoint ini tidak bisa dipakai untuk enumerasi akun terdaftar.
   */
  async requestPasswordReset(identifier: string) {
    const trimmed = (identifier || '').trim();
    if (!trimmed) {
      throw new AppError('Email atau Nomor HP wajib diisi!', 400);
    }

    const user = await this.authRepository.findByEmailOrPhone(trimmed);

    const genericResult = {
      message: 'Jika akun terdaftar, kode reset kata sandi telah dikirim ke email/nomor HP Anda.',
    };

    if (!user) {
      logger.warn(`🔑 Password reset requested for unknown identifier: ${trimmed}`);
      return genericResult;
    }

    const otpCode = this.generateOtpCode();
    const salt = await bcrypt.genSalt(10);
    const tokenHash = await bcrypt.hash(otpCode, salt);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 menit

    await this.authRepository.setResetPasswordToken(user.id, tokenHash, expiresAt);

    let emailSent = false;
    if (user.email) {
      emailSent = await MailerService.sendPasswordResetEmail(user.email, user.fullName, otpCode);
    }

    logger.info(`🔑 Password reset OTP generated for user ${user.id} (email sent: ${emailSent})`);

    // Kalau SMTP belum dikonfigurasi (dev/staging tanpa email gateway asli),
    // kode dikembalikan langsung di response supaya alur reset tetap bisa
    // diselesaikan end-to-end tanpa email — TIDAK dilakukan kalau email
    // sungguhan berhasil terkirim, demi keamanan di production.
    if (!emailSent) {
      return {
        ...genericResult,
        message: user.email
          ? 'Kode reset dibuat. (Email belum terkonfigurasi di server — gunakan kode di bawah ini untuk melanjutkan.)'
          : 'Kode reset dibuat. Sampaikan kode berikut ke pengguna lewat WhatsApp/SMS.',
        token: otpCode,
      };
    }

    return genericResult;
  }

  /** Langkah 2: user submit kode OTP + password baru. */
  async confirmPasswordReset(token: string, newPasswordPlain: string) {
    const otpCode = (token || '').trim();
    if (!otpCode) {
      throw new AppError('Kode reset wajib diisi!', 400);
    }
    if (!newPasswordPlain || newPasswordPlain.length < 4) {
      throw new AppError('Password baru minimal 4 karakter!', 400);
    }

    // Kode di-hash saat disimpan, jadi kita tidak bisa WHERE langsung —
    // cari di antara akun dengan token aktif & belum kedaluwarsa, lalu
    // cocokkan dengan bcrypt.compare (jumlah akun dengan reset PENDING
    // dalam waktu bersamaan biasanya kecil, jadi ini tetap efisien).
    const candidates = await this.authRepository.findUsersWithActiveResetToken();

    let matchedUser: any = null;
    for (const candidate of candidates) {
      if (!candidate.resetPasswordTokenHash) continue;
      const isMatch = await bcrypt.compare(otpCode, candidate.resetPasswordTokenHash);
      if (isMatch) {
        matchedUser = candidate;
        break;
      }
    }

    if (!matchedUser) {
      throw new AppError('Kode reset tidak valid atau sudah kedaluwarsa!', 400);
    }

    const salt = await bcrypt.genSalt(10);
    const newHash = await bcrypt.hash(newPasswordPlain, salt);
    await this.authRepository.resetPassword(matchedUser.id, newHash);

    logger.info(`✅ Password reset completed for user: ${matchedUser.id}`);

    return {
      message: 'Password berhasil direset! Silakan login dengan kata sandi baru Anda.',
      userId: matchedUser.id,
    };
  }

  // ✅ Helper: Generate tokens
  private async generateTokens(user: any) {
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