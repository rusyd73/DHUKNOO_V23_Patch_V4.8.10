import { PromoRepository } from './promo.repository';
import { AppError, NotFoundError } from '../../core/errors/AppError';
import { Prisma } from '@prisma/client';

export class PromoService {
  private promoRepo = new PromoRepository();

  listActivePromos() {
    return this.promoRepo.listActive();
  }

  /**
   * Memvalidasi kode promo terhadap harga order, dan menghitung besaran potongannya.
   * Tidak menambah usedCount — dipakai untuk pengecekan (mis. sebelum order dibuat).
   */
  async validateAndPreview(code: string, orderPrice: number) {
    const promo = await this.promoRepo.findActiveByCode(code);
    if (!promo) {
      throw new NotFoundError('Kode promo tidak ditemukan atau sudah tidak aktif!');
    }
    if (promo.expiresAt && promo.expiresAt < new Date()) {
      throw new AppError('Kode promo ini sudah kedaluwarsa!', 400);
    }
    if (promo.quota > 0 && promo.usedCount >= promo.quota) {
      throw new AppError('Kuota kode promo ini sudah habis!', 400);
    }
    if (orderPrice < Number(promo.minOrderPrice)) {
      throw new AppError(
        `Minimal order untuk memakai kode promo ini adalah Rp${Number(promo.minOrderPrice).toLocaleString('id-ID')}!`,
        400
      );
    }

    let discount = 0;
    if (promo.type === 'PERCENTAGE') {
      discount = (orderPrice * Number(promo.value)) / 100;
      if (promo.maxDiscount) {
        discount = Math.min(discount, Number(promo.maxDiscount));
      }
    } else {
      discount = Number(promo.value);
    }

    // Potongan tidak boleh melebihi harga order itu sendiri
    discount = Math.min(discount, orderPrice);

    return { promo, discount, finalPrice: orderPrice - discount };
  }

  markUsed(promoId: string) {
    return this.promoRepo.incrementUsage(promoId);
  }

  // 🆕 FIX "Promo race": dipanggil SEBELUM order benar-benar dibuat
  // (bukan sesudahnya seperti markUsed() lama), pakai UPDATE atomik
  // tryIncrementUsage() -- kalau kuota ternyata sudah habis PAS di
  // detik terakhir (kalah race melawan request lain), order creation
  // WAJIB dibatalkan di sini, sebelum order/pembayaran apa pun terjadi.
  async reserveUsage(promoId: string, quota: number, tx?: Prisma.TransactionClient): Promise<void> {
    const reserved = await this.promoRepo.tryIncrementUsage(promoId, quota, tx);
    if (!reserved) {
      throw new AppError('Kuota kode promo ini baru saja habis (dipakai orang lain lebih dulu). Silakan coba tanpa kode promo.', 409);
    }
  }

  createPromo(data: Parameters<PromoRepository['create']>[0]) {
    return this.promoRepo.create(data);
  }
}
