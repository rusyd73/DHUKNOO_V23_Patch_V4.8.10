import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { AuthRepository } from './auth.repository';
import { logger } from '../../config/logger';
import { ENV } from '../../config/env';
import { AppError } from '../../core/errors/AppError';
import { MailerService } from '../../config/mailer';
import { prisma } from '../../config/prisma';

export class AuthService {
  private authRepository = new AuthRepository();

  // ✅ Helper: Normalize email
  private normalizeEmail(email: string): string {
    if (!email) return '';
    return email.toLowerCase().trim();
  }

  // ============================================================
  // 🔒 GENERATE OTP CODE (6 digit)
  // ============================================================
  private generateOtpCode(): string {
    return crypto.randomInt(100000, 999999).toString();
  }

  // ============================================================
  // 🔓 REGISTER
  // ============================================================
  async registerUser(data: {
    email: string;
    passwordPlain: string;
    fullName: string;
    role: 'CUSTOMER' | 'DRIVER' | 'ADMIN' | 'MERCHANT';
    phone?: string;
    vehiclePlate?: string;
    vehicleModel?: string;
    driverServiceType?: 'BIKE' | 'CAR' | 'SEND';
    merchantName?: string;
    merchantCategory?: string;
    merchantAddress?: string;
    merchantLatitude?: number;
    merchantLongitude?: number;
  }) {
    const normalizedEmail = this.normalizeEmail(data.email);
    
    logger.info(`Registering new user: ${normalizedEmail} with role: ${data.role}`);
    
    const existing = await this.authRepository.findByEmail(normalizedEmail);
    if (existing) {
      throw new AppError('Alamat email sudah terdaftar di sistem DHUKNOO!', 400);
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(data.passwordPlain, salt);

    const user = await this.authRepository.createUser({
      email: normalizedEmail,
      passwordHash,
      fullName: data.fullName,
      role: data.role as any,
      // 🆕 FIX "Phone registration": diteruskan ke createUser() supaya
      // benar-benar tersimpan (lihat komentar lengkap di
      // auth.repository.ts createUser).
      phone: data.phone,
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

  // ============================================================
  // 🔒 CREATE ADMIN (satu-satunya jalur lain selain seed database
  // untuk membuat akun ADMIN baru). HANYA dipanggil dari
  // POST /api/admin/create-admin, yang sudah dilindungi
  // authenticateToken + authorizeRoles('ADMIN') di route handler --
  // artinya cuma admin yang sudah login yang bisa membuat admin baru.
  // Endpoint publik /api/auth/register TIDAK PERNAH memanggil method ini.
  // ============================================================
  async createAdmin(data: {
    email: string;
    passwordPlain: string;
    fullName: string;
    phone?: string;
  }) {
    const normalizedEmail = this.normalizeEmail(data.email);

    const existing = await this.authRepository.findByEmail(normalizedEmail);
    if (existing) {
      throw new AppError('Alamat email sudah terdaftar di sistem DHUKNOO!', 400);
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(data.passwordPlain, salt);

    // CATATAN: `phone` sengaja tidak diteruskan ke createUser -- di skema
    // saat ini nomor HP disimpan di CustomerProfile/DriverProfile
    // (phoneNumber), bukan di model User, dan akun ADMIN tidak punya
    // profile jenis itu. Diterima di signature untuk kompatibilitas
    // schema Zod (createAdminSchema) tapi tidak dipakai.
    const user = await this.authRepository.createUser({
      email: normalizedEmail,
      passwordHash,
      fullName: data.fullName,
      role: 'ADMIN' as any,
    });

    logger.info(`[ADMIN] Akun admin baru dibuat: ${user.id} (${normalizedEmail})`);

    return { id: user.id, email: user.email, role: user.role };
  }

  // ============================================================
  // 🔓 LOGIN
  // ============================================================
  // ============================================================
  // 🔓 LOGIN
  //
  // 🆕 FIX "Phone registration": sebelumnya method ini HANYA menerima
  // `email` dan HANYA memanggil findByEmail() -- padahal loginSchema
  // (schemas.ts) sudah lama menerima email ATAU phone ATAU emailOrPhone
  // (`.refine((data) => !!(data.email || data.phone || data.emailOrPhone))`),
  // dan AuthRepository.findByEmailOrPhone() (yang menangani normalisasi
  // format nomor HP Indonesia 0xxx/62xxx) sudah dibuat lengkap tapi
  // TIDAK PERNAH DIPANGGIL SAMA SEKALI dari mana pun -- dead code.
  // Login pakai nomor HP TIDAK PERNAH benar-benar berfungsi, DAN
  // (sebelum fix di createUser di atas) kalaupun dipanggil, tidak akan
  // menemukan siapa pun karena phoneNumber selalu NULL.
  // Sekarang menerima `identifier` (email atau nomor HP) dan pakai
  // findByEmailOrPhone() yang sudah menangani keduanya.
  // ============================================================
  async loginUser(identifier: string, passwordPlain: string) {
    const trimmedIdentifier = (identifier || '').trim();

    logger.info(`🔍 Login attempt for identifier: "${trimmedIdentifier}"`);

    const user = await this.authRepository.findByEmailOrPhone(trimmedIdentifier);

    if (!user) {
      logger.warn(`❌ User not found for identifier: ${trimmedIdentifier}`);
      throw new AppError('User tidak ditemukan! Periksa kembali email/nomor HP Anda.', 404);
    }

    const isValid = await bcrypt.compare(passwordPlain, user.passwordHash);
    if (!isValid) {
      logger.warn(`❌ Invalid password for user: ${user.id}`);
      throw new AppError('Password salah! Periksa kembali password Anda.', 401);
    }

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
  // 🔒 REQUEST PASSWORD RESET - FAIL CLOSED
  // ============================================================
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
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await this.authRepository.setResetPasswordToken(user.id, tokenHash, expiresAt);

    let emailSent = false;
    if (user.email) {
      emailSent = await MailerService.sendPasswordResetEmail(user.email, user.fullName, otpCode);
    }

    logger.info(`🔑 Password reset OTP generated for user ${user.id} (email sent: ${emailSent})`);

    if (!emailSent) {
      await this.authRepository.setResetPasswordToken(user.id, null, null);

      logger.error(`[PASSWORD RESET] Failed to send OTP email to ${user.email}`);
      
      if (ENV.NODE_ENV === 'production') {
        throw new AppError(
          'Gagal mengirim kode reset password. Silakan coba lagi atau hubungi customer service.',
          503
        );
      }

      logger.info(`[DEV] OTP for ${user.email}: ${otpCode}`);
      
      return {
        ...genericResult,
        message: 'Kode reset dibuat. (Mode development: cek log server untuk kode OTP.)',
      };
    }

    return genericResult;
  }

  // ============================================================
  // 🔒 CONFIRM PASSWORD RESET
  // ============================================================
  async confirmPasswordReset(token: string, newPasswordPlain: string) {
    const otpCode = (token || '').trim();
    if (!otpCode) {
      throw new AppError('Kode reset wajib diisi!', 400);
    }
    if (!newPasswordPlain || newPasswordPlain.length < 4) {
      throw new AppError('Password baru minimal 4 karakter!', 400);
    }

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

  // ============================================================
  // 🔒 GET PROFILE
  // ============================================================
  async getProfile(userId: string) {
    const user = await this.authRepository.findById(userId);
    if (!user) {
      throw new AppError('User tidak ditemukan!', 404);
    }
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      isActive: user.isActive,
      createdAt: user.createdAt,
    };
  }

  // ============================================================
  // 🔒 GENERATE TOKENS
  // ============================================================
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

  // ============================================================
  // 🔓 REFRESH TOKEN - ATOMIC (CEGAH RACE CONDITION)
  // ============================================================
  async handleRefreshToken(token: string) {
    try {
      // 1. Verifikasi JWT
      const decoded = jwt.verify(token, ENV.JWT_REFRESH_SECRET) as any;
      
      // 2. 🔒 ATOMIC: Cari user dengan refresh token yang sama
      const user = await prisma.user.findUnique({
        where: { 
          id: decoded.id,
          refreshToken: token,
        },
      });

      if (!user) {
        throw new AppError('Token refresh tidak valid!', 403);
      }

      // 3. Generate token baru
      const newAccessToken = jwt.sign(
        { id: user.id, email: user.email, role: user.role },
        ENV.JWT_SECRET,
        { expiresIn: '15m' }
      );

      const newRefreshToken = jwt.sign(
        { id: user.id, email: user.email, role: user.role },
        ENV.JWT_REFRESH_SECRET,
        { expiresIn: '7d' }
      );

      // 4. 🔒 UPDATE refresh token di database (atomic)
      const updated = await prisma.user.updateMany({
        where: { 
          id: user.id,
          refreshToken: token, // ← HANYA jika token masih sama
        },
        data: {
          refreshToken: newRefreshToken,
        },
      });

      // 5. 🔒 Jika tidak ada yang ter-update, berarti ada race condition
      if (updated.count === 0) {
        // Coba ambil user dengan token terbaru
        const latestUser = await prisma.user.findUnique({
          where: { id: user.id },
        });
        
        if (latestUser && latestUser.refreshToken) {
          // Token sudah dirotasi, beri tahu client untuk retry
          throw new AppError('Refresh token sudah diperbarui. Silakan coba lagi.', 409);
        }
        throw new AppError('Token refresh tidak valid!', 403);
      }

      logger.info(`✅ Refresh token rotated for user: ${user.id}`);

      return { 
        accessToken: newAccessToken, 
        refreshToken: newRefreshToken 
      };

    } catch (err) {
      logger.error('Error during token refresh exchange: %s', (err as Error).message || err);
      if (err instanceof AppError) throw err;
      throw new AppError('Autentikasi gagal. Sesi Anda kedaluwarsa!', 401);
    }
  }

  // ============================================================
  // 🔒 LOGOUT
  // ============================================================
  async logout(userId: string) {
    await this.authRepository.updateRefreshToken(userId, null);
    return { message: 'Berhasil keluar dari sesi ini.' };
  }

  // ============================================================
  // 🔒 CHANGE PASSWORD
  // ============================================================
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