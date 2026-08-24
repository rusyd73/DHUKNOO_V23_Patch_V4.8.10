import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { AuthRepository } from './auth.repository';
import { logger } from '../../config/logger';
import { ENV } from '../../config/env';
import { AppError } from '../../core/errors/AppError';
import { WhatsAppService } from '../../config/whatsapp';
import { prisma } from '../../config/prisma';

export class AuthService {
  private authRepository = new AuthRepository();

  // 🆕 FIX "Refresh token backend masih plaintext" (audit lanjutan):
  // User.refreshToken SEBELUMNYA menyimpan JWT refresh token APA
  // ADANYA (plaintext) -- kalau database bocor (SQL injection, backup
  // dicuri, insider access), penyerang langsung dapat daftar refresh
  // token VALID untuk SEMUA user, siap pakai tanpa perlu membobol
  // apa pun lagi (beda dari password yang di-hash bcrypt -- refresh
  // token ini kebalikannya, disimpan mentah). Sekarang di-hash SHA-256
  // sebelum disimpan/dibandingkan -- SHA-256 (bukan bcrypt) sengaja
  // dipilih karena refresh token JWT sudah py entropi tinggi dari
  // signature kriptografisnya sendiri (beda dari password manusia yang
  // butuh hash lambat/bcrypt untuk tahan brute-force) -- tujuan hash
  // di sini murni supaya kebocoran DB tidak langsung memberi token
  // siap pakai, bukan menahan brute-force (SHA-256 cepat & cukup untuk
  // itu, dan tetap deterministic sehingga bisa dipakai di WHERE clause
  // Prisma untuk pencarian/rotasi atomik seperti sebelumnya).
  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

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
// 🔒 REQUEST PASSWORD RESET — WHATSAPP V4.8.10
// ============================================================
async requestPasswordReset(identifier: string) {
  const trimmed = (identifier || '').trim();

  if (!trimmed) {
    throw new AppError(
      'Email atau Nomor HP wajib diisi!',
      400
    );
  }

  const user =
    await this.authRepository.findByEmailOrPhone(trimmed);

  /**
   * Fail-closed:
   * Jangan membocorkan apakah email/nomor HP terdaftar.
   */
  const genericResult = {
    message:
      'Jika akun terdaftar, kode reset kata sandi telah dikirim ke email/nomor HP Anda.',
  };

  if (!user) {
    logger.warn(
      `🔑 Password reset requested for unknown identifier: ${trimmed}`
    );

    return genericResult;
  }

  // ==========================================================
  // GENERATE OTP
  // ==========================================================

  const otpCode = this.generateOtpCode();

  const salt = await bcrypt.genSalt(10);

  const tokenHash =
    await bcrypt.hash(otpCode, salt);

  const expiresAt =
    new Date(Date.now() + 15 * 60 * 1000);

  // ==========================================================
  // SIMPAN OTP HASH
  // ==========================================================

  await this.authRepository.setResetPasswordToken(
    user.id,
    tokenHash,
    expiresAt
  );

  // ==========================================================
  // AMBIL NOMOR WHATSAPP PENDAFTAR
  // ==========================================================

  const userAny = user as any;

  const phoneNumber =
    userAny.phoneNumber ||
    userAny.phone ||
    userAny.customerProfile?.phoneNumber ||
    userAny.driverProfile?.phoneNumber ||
    userAny.merchantProfile?.phoneNumber ||
    (
      trimmed.startsWith('+') ||
      /^\d+$/.test(trimmed)
        ? trimmed
        : ''
    );

  // ==========================================================
  // NOMOR TIDAK DITEMUKAN
  // ==========================================================

  if (!phoneNumber) {
    logger.error(
      `[PASSWORD RESET] Nomor WhatsApp tidak ditemukan untuk user ${user.id} (${user.email}).`
    );

    // Jangan meninggalkan OTP aktif jika nomor tidak tersedia.
    // Berlaku di semua environment — OTP TIDAK PERNAH dikirim
    // ke client lewat response API maupun ditampilkan di dashboard.
    await this.authRepository.setResetPasswordToken(
      user.id,
      null,
      null
    );

    throw new AppError(
      'Nomor WhatsApp akun tidak tersedia. Silakan hubungi customer service DHUKNOO.',
      503
    );
  }

  // ==========================================================
  // BENTUK LINK WHATSAPP
  //
  // Kode OTP disisipkan LANGSUNG ke dalam pesan wa.me yang
  // sudah di-encode. Kode tersebut hanya pernah "ada" di dalam
  // URL WhatsApp ini — TIDAK PERNAH dikirim balik ke client
  // sebagai field terpisah, dan TIDAK PERNAH ditampilkan di
  // layar/dashboard aplikasi.
  // ==========================================================

  const whatsappUrl =
    WhatsAppService.buildPasswordResetUrl(
      phoneNumber,
      user.fullName,
      otpCode
    );

  // ==========================================================
  // LOG (server-side saja, tidak pernah dikirim ke client)
  // ==========================================================

  logger.info(
    `🔑 Password reset OTP generated for user ${user.id} ` +
    `(WhatsApp link ready: ${Boolean(whatsappUrl)})`
  );

  if (ENV.NODE_ENV !== 'production') {
    // Log dev tetap ada untuk debugging lewat terminal server,
    // TAPI tidak pernah dikirim ke response/browser pengguna.
    logger.debug(
      `[DEV-ONLY LOG] OTP for ${user.email || user.id}: ${otpCode}`
    );
  }

  // ==========================================================
  // RESPONSE KE CLIENT
  //
  // Hanya mengembalikan URL WhatsApp (tanpa kode OTP dalam
  // bentuk field terpisah yang bisa ditampilkan di UI) beserat
  // nomor HP tujuan (untuk ditampilkan sebagai konfirmasi,
  // BUKAN kode OTP-nya).
  //
  // Frontend WAJIB langsung membuka whatsappUrl ini (window.open)
  // begitu response diterima — bukan menampilkan/menyimpan kode
  // OTP-nya di state/UI mana pun. Link wa.me otomatis membuka
  // WhatsApp Web bila diakses dari browser desktop, dan membuka
  // aplikasi WhatsApp langsung bila diakses dari HP.
  // ==========================================================

  return {
    ...genericResult,
    phoneNumber,
    whatsappUrl,
    message:
      'Kode reset dibuat. Silakan cek pesan WhatsApp yang baru saja terbuka.',
  };
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

    await this.authRepository.updateRefreshToken(user.id, this.hashToken(refreshToken));

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
      const tokenHash = this.hashToken(token);
      
      // 2. 🔒 ATOMIC: Cari user dengan HASH refresh token yang sama
      // (bukan token mentah -- lihat komentar di hashToken()).
      const user = await prisma.user.findUnique({
        where: { 
          id: decoded.id,
          refreshToken: tokenHash,
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

      // 4. 🔒 UPDATE hash refresh token baru di database (atomic)
      const updated = await prisma.user.updateMany({
        where: { 
          id: user.id,
          refreshToken: tokenHash, // ← HANYA jika hash token masih sama
        },
        data: {
          refreshToken: this.hashToken(newRefreshToken),
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

    // 🆕 FIX "Change password belum mencabut refresh session" (audit
    // lanjutan): SEBELUMNYA ganti password HANYA update passwordHash,
    // TIDAK PERNAH menyentuh refreshToken -- kalau ada refresh token
    // yang SUDAH DICURI sebelumnya (mis. lewat XSS sebelum fix
    // httpOnly, atau device hilang), token curian itu TETAP VALID
    // TANPA BATAS (terus dirotasi otomatis lewat handleRefreshToken)
    // MESKIPUN user sudah "mengamankan" akunnya dengan ganti password.
    // Ganti password TIDAK memberi perlindungan APA PUN terhadap sesi
    // yang sudah dibajak -- padahal itu justru skenario paling umum
    // orang mengganti password (curiga akun dibobol). Sekarang refresh
    // token dicabut (di-null-kan) begitu password berhasil diganti --
    // SEMUA sesi lain (termasuk yang dicuri) langsung mati, dipaksa
    // login ulang di device manapun.
    await this.authRepository.updateRefreshToken(userId, null);

    logger.info(`Password updated successfully for user id: ${userId} -- semua refresh session dicabut.`);
    return true;
  }
}