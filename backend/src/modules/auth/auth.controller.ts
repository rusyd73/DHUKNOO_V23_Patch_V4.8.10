import { Response } from 'express';
import jwt from 'jsonwebtoken';
import { AuthenticatedRequest } from '../../core/middleware/auth.middleware';
import { AuthService } from './auth.service';
import { AppError } from '../../core/errors/AppError';
import { logger } from '../../config/logger';
import { ENV } from '../../config/env';
import { AuditLogger } from '../../core/logging/audit.logger';

export class AuthController {
  private authService = new AuthService();

  // ============================================================
  // 🔓 REGISTER
  // ============================================================
  register = async (req: AuthenticatedRequest, res: Response) => {
    try {
      // 🆕 FIX BUG NYATA (ditemukan dari log production): sebelumnya
      // req.body diteruskan MENTAH ke registerUser(), padahal
      // registerSchema (validasi Zod di route) memvalidasi field
      // `password`, sementara registerUser() mengharapkan field
      // bernama `passwordPlain` -- MISMATCH NAMA, bukan typo di satu
      // tempat saja. Akibatnya `data.passwordPlain` SELALU undefined,
      // dan `bcrypt.hash(undefined, salt)` throw
      // "Illegal arguments: undefined, string" -- SEMUA percobaan
      // registrasi gagal 400 sejak awal (dikonfirmasi dari log:
      // "Register error: Illegal arguments: undefined, string").
      // Diperbaiki dengan mapping eksplisit, bukan forward mentah --
      // sekalian mencegah field tak terduga lain ikut terbawa diam-diam.
      const { email, password, fullName, phone, role, vehiclePlate, vehicleModel, driverServiceType, merchantName, merchantCategory, merchantAddress, merchantLatitude, merchantLongitude } = req.body;

      const result = await this.authService.registerUser({
        email,
        passwordPlain: password,
        fullName,
        phone,
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
      return res.status(201).json({
        success: true,
        message: 'Registrasi berhasil! Silakan login.',
        data: result,
      });
    } catch (err: any) {
      logger.error('Register error: %s', err.message);
      const status = err instanceof AppError ? err.statusCode : 400;
      return res.status(status).json({ success: false, error: err.message });
    }
  };

  // ============================================================
  // 🔓 LOGIN - SET HTTPONLY COOKIE + REFRESH TOKEN DI BODY
  //
  // 🆕 FIX AUTH CONTRACT: frontend (AuthFlow.tsx) SELALU membaca
  // response.refreshToken saat login (`onSuccess(user, accessToken,
  // refreshToken)`), tapi endpoint ini sebelumnya sengaja TIDAK
  // mengirimkannya -- akibatnya refreshToken di client SELALU undefined
  // sejak awal, tersimpan sebagai string "undefined" di localStorage.
  // Konsisten dengan fix di refreshToken() di bawah: refreshToken
  // sekarang dikirim di body JUGA (bukan cuma cookie), supaya client
  // native/cross-origin (Android) yang cookie-nya tidak reliable tetap
  // dapat token yang valid sejak login pertama, bukan cuma dari cookie
  // yang mungkin tidak pernah nyampe ke WebView.
  // ============================================================
  login = async (req: AuthenticatedRequest, res: Response) => {
    try {
      // 🆕 FIX "Phone registration": loginSchema menerima email ATAU
      // phone ATAU emailOrPhone -- sebelumnya cuma `email` yang
      // diambil, jadi login pakai nomor HP kirim `undefined` ke
      // loginUser() dan selalu gagal. Sekarang ambil identifier apa pun
      // yang diisi client.
      const { email, phone, emailOrPhone, password } = req.body;
      const identifier = emailOrPhone || email || phone;
      const result = await this.authService.loginUser(identifier, password);

      // ✅ SET REFRESH TOKEN DI HTTPONLY COOKIE (untuk client web)
      res.cookie('refreshToken', result.refreshToken, {
        httpOnly: true,
        secure: ENV.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 hari
        path: '/api/auth/refresh',
      });

      return res.status(200).json({
        success: true,
        message: 'Login berhasil!',
        data: {
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          user: result.user,
        },
      });
    } catch (err: any) {
      logger.error('Login error: %s', err.message);
      const status = err instanceof AppError ? err.statusCode : 401;
      return res.status(status).json({ success: false, error: err.message });
    }
  };

  // ============================================================
  // 🔓 REFRESH TOKEN
  //
  // 🆕 FIX AUTH CONTRACT: sebelumnya endpoint ini HANYA membaca
  // req.cookies.refreshToken, sementara frontend (auth.api.ts, apiClient.ts)
  // SELALU mengirim { refreshToken } di BODY dan mengharapkan refreshToken
  // baru balik di BODY juga -- kontrak yang sama sekali tidak nyambung.
  // Di web browser same-origin, ini "kebetulan tetap jalan" karena cookie
  // tetap terkirim otomatis terlepas dari body. TAPI di build Android
  // (Capacitor WebView, origin beda total dari domain backend) dan di
  // axios client yang TIDAK di-set withCredentials:true (lihat fix di
  // frontend/src/shared-packages/shared-api.ts), cookie httpOnly TIDAK
  // PERNAH terkirim/tersimpan sama sekali -- satu-satunya jalur yang
  // bisa jalan adalah body. Sekarang terima dari KEDUANYA (cookie
  // diprioritaskan kalau ada -- lebih aman, tahan XSS -- body dipakai
  // sebagai fallback untuk client yang cookie-nya tidak reliable).
  // ============================================================
  refreshToken = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const refreshToken = req.cookies?.refreshToken || req.body?.refreshToken;

      if (!refreshToken) {
        return res.status(401).json({ success: false, error: 'Refresh token tidak ditemukan' });
      }

      const result = await this.authService.handleRefreshToken(refreshToken);

      // ✅ SET REFRESH TOKEN BARU DI COOKIE (ROTASI) -- tetap dipasang
      // untuk client web yang memang bisa menerima cookie httpOnly.
      res.cookie('refreshToken', result.refreshToken, {
        httpOnly: true,
        secure: ENV.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000,
        path: '/api/auth/refresh',
      });

      // 🆕 FIX: refreshToken baru JUGA dikirim di body -- WAJIB untuk
      // client native/cross-origin (Android) yang cookie-nya tidak bisa
      // diandalkan (WebView cross-site + axios tanpa withCredentials
      // sebelumnya membuat cookie path mati total). Untuk client web
      // yang memang mengandalkan cookie httpOnly, field ini di body
      // TIDAK MENAMBAH risiko baru dibanding sebelumnya -- access token
      // (yang risikonya setara: sekali dicuri XSS, sesi bisa dibajak)
      // SUDAH disimpan di localStorage sejak awal di codebase ini,
      // jadi model keamanan "murni httpOnly, tidak tersentuh JS sama
      // sekali" itu SUDAH TIDAK berlaku utuh untuk arsitektur app ini.
      // Trade-off ini didokumentasikan, bukan diabaikan -- lihat catatan
      // di README/audit soal migrasi ke Capacitor Secure Storage /
      // Preferences API untuk native build sebagai perbaikan lanjutan.
      return res.status(200).json({
        success: true,
        data: {
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
        },
      });
    } catch (err: any) {
      logger.error('Refresh token error: %s', err.message);
      const status = err instanceof AppError ? err.statusCode : 401;
      return res.status(status).json({ success: false, error: err.message });
    }
  };

  // ============================================================
  // 🔓 REFRESH TOKEN - Alias untuk routes
  // ============================================================
  refresh = async (req: AuthenticatedRequest, res: Response) => {
    return this.refreshToken(req, res);
  };

  // ============================================================
  // 🔒 LOGOUT - HAPUS COOKIE
  // ============================================================
  logout = async (req: AuthenticatedRequest, res: Response) => {
    // 🆕 FIX P1 "Logout pernah 401 tanpa auth; pastikan logout
    // idempotent/ditangani saat token sudah invalid" (audit driver-jobs).
    // SEBELUMNYA route ini dipasangi authenticateToken (lihat
    // auth.routes.ts) yang MENOLAK KERAS (401) begitu access token
    // kedaluwarsa/tidak ada -- padahal itu skenario PALING LUMRAH untuk
    // logout (user idle lama, access token 15 menit sudah lewat, baru
    // klik logout). Client jadi tidak pernah bisa "berhasil logout"
    // lewat server dalam kondisi itu, walau niatnya (keluar dari sesi)
    // seharusnya SELALU bisa dipenuhi tanpa perlu access token yang
    // masih hidup -- yang benar-benar perlu dicabut adalah REFRESH
    // token (di cookie httpOnly), bukan access token.
    //
    // Sekarang authenticateToken DILEPAS dari route ini (lihat
    // auth.routes.ts) dan logic identifikasi user dibuat TOLERAN
    // bertingkat:
    //   1. Access token masih valid (req.user ada, lewat middleware
    //      opsional) -> pakai userId dari situ, jalur normal.
    //   2. Access token tidak ada/kedaluwarsa -> coba baca & verifikasi
    //      cookie refreshToken (JWT terpisah, umur 7 hari, secret
    //      berbeda) untuk dapat userId, lalu cabut sesi itu juga.
    //   3. Keduanya tidak bisa diverifikasi -> tidak ada sesi
    //      server-side yang bisa/perlu dicabut (sudah invalid dengan
    //      sendirinya) -- logout tetap dianggap BERHASIL (200) dan
    //      cookie tetap dihapus, karena dari sudut pandang client,
    //      "tidak lagi terautentikasi" sudah tercapai.
    try {
      let userId = req.user?.id;

      if (!userId) {
        const refreshTokenFromCookie = (req as any).cookies?.refreshToken;
        if (refreshTokenFromCookie) {
          try {
            const decoded = jwt.verify(refreshTokenFromCookie, ENV.JWT_REFRESH_SECRET) as any;
            userId = decoded?.id;
          } catch {
            // Refresh token juga sudah tidak valid/kedaluwarsa -- tidak
            // apa-apa, lanjut ke langkah 3 di atas (idempotent success).
          }
        }
      }

      if (userId) {
        await this.authService.logout(userId);
      }

      res.clearCookie('refreshToken', {
        httpOnly: true,
        secure: ENV.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/api/auth/refresh',
      });

      return res.status(200).json({
        success: true,
        message: 'Logout berhasil',
      });
    } catch (err: any) {
      logger.error('Logout error: %s', err.message);
      return res.status(500).json({ success: false, error: err.message });
    }
  };

  // ============================================================
  // 🔒 CHANGE PASSWORD
  // ============================================================
  changePassword = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }
      const { oldPassword, newPassword } = req.body;
      await this.authService.changePassword(userId, oldPassword, newPassword);
      await AuditLogger.log(userId, 'USER_CHANGE_PASSWORD', 'Password diubah oleh user sendiri.');
      return res.status(200).json({
        success: true,
        message: 'Password berhasil diubah!',
      });
    } catch (err: any) {
      logger.error('Change password error: %s', err.message);
      const status = err instanceof AppError ? err.statusCode : 400;
      return res.status(status).json({ success: false, error: err.message });
    }
  };

  // ============================================================
  // 🔒 GET PROFILE
  // ============================================================
  getProfile = async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }
      const user = await this.authService.getProfile(userId);
      return res.status(200).json({
        success: true,
        data: user,
      });
    } catch (err: any) {
      logger.error('Get profile error: %s', err.message);
      const status = err instanceof AppError ? err.statusCode : 404;
      return res.status(status).json({ success: false, error: err.message });
    }
  };

  // ============================================================
  // 🔓 REQUEST PASSWORD RESET - FAIL CLOSED
  // ============================================================
  requestPasswordReset = async (req: AuthenticatedRequest, res: Response) => {
    try {
      // 🔒 CEK SMTP KONFIGURASI DI PRODUCTION
      if (ENV.NODE_ENV === 'production' && !ENV.SMTP_HOST) {
        return res.status(503).json({
          success: false,
          error: 'Password reset service temporarily unavailable. Please contact customer support.',
          code: 'SMTP_NOT_CONFIGURATED',
        });
      }

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

  // ============================================================
  // 🔓 CONFIRM PASSWORD RESET
  // ============================================================
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
}