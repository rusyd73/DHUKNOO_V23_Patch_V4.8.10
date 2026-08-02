/**
 * Utilitas WhatsApp Deep-Link — TIDAK mengirim pesan otomatis dari server (butuh
 * WhatsApp Business API berbayar untuk itu). Ini membuka tab wa.me baru dengan
 * pesan yang sudah diisi otomatis (prefilled), lalu ADMIN/DRIVER/CUSTOMER sendiri
 * yang menekan "Kirim" di WhatsApp mereka — jadi tidak melanggar kebijakan WhatsApp
 * soal pesan otomatis/spam, dan tidak butuh kredensial API pihak ketiga apa pun.
 *
 * Nomor DEFAULT (fallback CS/Admin) ada di ADMIN_WHATSAPP_NUMBER — dipakai HANYA
 * kalau nomor pendaftar (customer/driver) memang belum ada di database.
 */

export const ADMIN_WHATSAPP_NUMBER = '6281252185515';

/** Ubah nomor lokal Indonesia (08xxxx) menjadi format internasional wa.me (62xxxx), tanpa spasi/simbol. */
export function normalizeIndonesianPhone(raw?: string | null): string | null {
  if (!raw) return null;
  const digitsOnly = raw.replace(/[^\d]/g, '');
  if (!digitsOnly) return null;
  if (digitsOnly.startsWith('0')) return `62${digitsOnly.slice(1)}`;
  if (digitsOnly.startsWith('62')) return digitsOnly;
  return `62${digitsOnly}`;
}

/** Buka tab WhatsApp baru berisi pesan yang sudah diisi otomatis ke nomor tujuan. */
export function openWhatsAppMessage(phoneNumber: string | null | undefined, message: string) {
  const normalized = normalizeIndonesianPhone(phoneNumber) || ADMIN_WHATSAPP_NUMBER;
  const url = `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
  window.open(url, '_blank', 'noopener,noreferrer');
}

/**
 * Fungsi ucapan terima kasih dari Admin/Platform ke customer/driver yang baru
 * saja menyelesaikan sebuah order — membuka WhatsApp ke nomor pendaftar (kalau
 * ada), fallback ke nomor Admin/CS kalau belum terdaftar.
 */
export function sendAdminThankYouChat(params: {
  phoneNumber?: string | null;
  recipientName?: string | null;
  orderId?: string;
}) {
  const { phoneNumber, recipientName, orderId } = params;
  const namePart = recipientName ? `${recipientName}, ` : '';
  const orderPart = orderId ? ` (Order #${orderId.slice(0, 8)})` : '';
  const message =
    `Halo ${namePart}terima kasih telah menggunakan layanan DHUKNOO Ride${orderPart}! 🙏🍏 ` +
    `Semoga perjalanan Anda nyaman. Kalau ada kendala atau masukan, jangan ragu balas chat ini ya.`;
  openWhatsAppMessage(phoneNumber, message);
}

/** Kontak umum (bukan ucapan terima kasih) — dipakai Admin/Driver/Customer untuk chat langsung. */
export function openWhatsAppContact(phoneNumber: string | null | undefined, context?: string) {
  const message = context
    ? `Halo, saya menghubungi Anda terkait ${context} di platform DHUKNOO Ride.`
    : `Halo, saya menghubungi Anda lewat platform DHUKNOO Ride.`;
  openWhatsAppMessage(phoneNumber, message);
}
