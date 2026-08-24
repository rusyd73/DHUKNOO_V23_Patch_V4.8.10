import { logger } from './logger';

/**
 * DHUKNOO WhatsApp Helper
 *
 * V4.8.10
 *
 * CATATAN:
 * - Tidak menggunakan WhatsApp Cloud API.
 * - Tidak membutuhkan access token.
 * - Tidak membutuhkan password WhatsApp.
 * - Tidak mengirim pesan dari server.
 *
 * Fungsi ini hanya membantu membentuk URL WhatsApp `wa.me`
 * yang kemudian dibuka oleh browser/device pengguna.
 *
 * Mekanisme ini mengikuti pola WhatsApp yang sudah digunakan
 * DHUKNOO pada fitur konfirmasi pembayaran/top-up.
 */

export class WhatsAppService {
  /**
   * Normalisasi nomor Indonesia menjadi format internasional.
   *
   * Contoh:
   * 081252185515
   * ↓
   * 6281252185515
   */
  static normalizePhone(phone: string): string {
    let value = (phone || '').trim();

    if (!value) return '';

    // Hilangkan karakter selain angka dan +
    value = value.replace(/[^\d+]/g, '');

    // +62812...
    if (value.startsWith('+62')) {
      return value.substring(1);
    }

    // 62812...
    if (value.startsWith('62')) {
      return value;
    }

    // 0812...
    if (value.startsWith('0')) {
      return `62${value.substring(1)}`;
    }

    // Nomor tanpa kode negara
    return value;
  }

  /**
   * Membentuk URL WhatsApp dengan pesan yang sudah di-encode.
   *
   * Tidak mengirim pesan.
   * Browser pengguna yang membuka URL ini.
   */
  static buildWhatsAppUrl(phone: string, message: string): string | null {
    const normalizedPhone = this.normalizePhone(phone);

    if (!normalizedPhone) {
      return null;
    }

    return `https://wa.me/${normalizedPhone}?text=${encodeURIComponent(
      message
    )}`;
  }

  /**
   * Pesan khusus reset password DHUKNOO.
   */
  static buildPasswordResetMessage(
    fullName: string | null | undefined,
    otpCode: string
  ): string {
    return [
      '🔐 *DHUKNOO Ride — Reset Kata Sandi*',
      '',
      `Halo ${fullName || 'Pengguna DHUKNOO'},`,
      '',
      'Kode OTP untuk reset kata sandi Anda adalah:',
      '',
      `*${otpCode}*`,
      '',
      'Kode ini berlaku selama *15 menit*.',
      '',
      'Jika Anda tidak meminta reset kata sandi, abaikan pesan ini.',
      '',
      'Terima kasih.',
      '*DHUKNOO Ride*',
    ].join('\n');
  }

  /**
   * Membentuk link WhatsApp khusus reset password.
   *
   * Digunakan frontend untuk membuka WhatsApp.
   */
  static buildPasswordResetUrl(
    phone: string,
    fullName: string | null | undefined,
    otpCode: string
  ): string | null {
    const message = this.buildPasswordResetMessage(fullName, otpCode);

    return this.buildWhatsAppUrl(phone, message);
  }

  /**
   * Dipertahankan untuk kompatibilitas dengan kode lama.
   *
   * V4.8.10 tidak mengirim WhatsApp dari backend.
   *
   * Pengiriman dilakukan melalui WhatsApp Web/App pada perangkat
   * pengguna menggunakan URL wa.me.
   */
  static async sendPasswordResetOTP(
    phone: string,
    fullName: string | null | undefined,
    otpCode: string
  ): Promise<boolean> {
    const url = this.buildPasswordResetUrl(phone, fullName, otpCode);

    if (!url) {
      logger.warn(
        `[WhatsApp] Nomor HP tidak valid untuk password reset: ${phone}`
      );
      return false;
    }

    logger.info(
      `[WhatsApp] Password reset link siap untuk nomor ${this.normalizePhone(
        phone
      )}`
    );

    // Jangan menganggap pesan sudah terkirim.
    // Backend tidak mempunyai akses untuk mengirim pesan.
    return false;
  }
}