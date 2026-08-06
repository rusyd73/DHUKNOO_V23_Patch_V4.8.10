import nodemailer, { Transporter } from 'nodemailer';
import { logger } from './logger';

/**
 * Layanan email untuk mengirim struk/notifikasi. Memakai pola yang sama seperti
 * RedisService: kalau SMTP belum dikonfigurasi di .env, layanan ini otomatis
 * "mati" dengan aman (tidak melempar error, cuma log peringatan) — supaya
 * aplikasi tetap bisa dites tanpa perlu setup email dulu.
 *
 * Cara mengaktifkan (opsional): isi 4 variabel ini di .env —
 *   SMTP_HOST=smtp.gmail.com
 *   SMTP_PORT=587
 *   SMTP_USER=akun-anda@gmail.com
 *   SMTP_PASS=app-password-16-digit   (BUKAN password akun biasa — buat App Password
 *                                       khusus di myaccount.google.com/apppasswords)
 */
export class MailerService {
  private static transporter: Transporter | null = null;
  private static isEnabled = false;

  static init() {
    const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;

    if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
      logger.warn('SMTP belum dikonfigurasi (SMTP_HOST/PORT/USER/PASS kosong) — fitur kirim email struk dinonaktifkan.');
      this.isEnabled = false;
      return;
    }

    try {
      this.transporter = nodemailer.createTransport({
        host: SMTP_HOST,
        port: Number(SMTP_PORT),
        secure: Number(SMTP_PORT) === 465,
        auth: { user: SMTP_USER, pass: SMTP_PASS },
      });
      this.isEnabled = true;
      logger.info('MailerService (SMTP) berhasil diinisialisasi.');
    } catch (err: any) {
      logger.error('Gagal inisialisasi MailerService: %s', err.message);
      this.isEnabled = false;
    }
  }

  static async sendReceiptEmail(to: string, subject: string, html: string): Promise<boolean> {
    if (!this.isEnabled || !this.transporter) {
      logger.warn(`MailerService tidak aktif — email struk ke ${to} DILEWATI (SMTP belum dikonfigurasi).`);
      return false;
    }
    try {
      await this.transporter.sendMail({
        from: `"DHUKNOO Platform" <${process.env.SMTP_USER}>`,
        to,
        subject,
        html,
      });
      logger.info(`Email struk berhasil dikirim ke ${to}`);
      return true;
    } catch (err: any) {
      logger.error('Gagal mengirim email struk: %s', err.message);
      return false;
    }
  }

  static get enabled(): boolean {
    return this.isEnabled;
  }

  // 🆕 PERBAIKAN #1 (Lupa/Reset Password): kirim kode OTP reset password ke
  // email pendaftar. Kalau SMTP belum dikonfigurasi, panggilan ini balik
  // `false` dengan aman — pemanggil (AuthService) sudah punya fallback untuk
  // situasi ini (lihat auth.service.ts).
  static async sendPasswordResetEmail(to: string, fullName: string, otpCode: string): Promise<boolean> {
    const html = `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color:#00A85A;">DHUKNOO Platform — Reset Kata Sandi</h2>
        <p>Halo ${fullName || 'Pengguna'},</p>
        <p>Kami menerima permintaan untuk mereset kata sandi akun Anda. Gunakan kode berikut untuk melanjutkan:</p>
        <p style="font-size: 28px; font-weight: bold; letter-spacing: 4px; background:#f2f2f2; padding: 12px 16px; border-radius: 8px; text-align:center;">${otpCode}</p>
        <p>Kode ini berlaku selama <b>15 menit</b>. Jika Anda tidak meminta reset kata sandi, abaikan email ini.</p>
        <p style="color:#888; font-size:12px;">DHUKNOO Ride — Ojek Batu-Malang Raya</p>
      </div>
    `;
    return this.sendReceiptEmail(to, 'Kode Reset Kata Sandi DHUKNOO', html);
  }
}
