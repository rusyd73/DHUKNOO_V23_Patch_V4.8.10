import { PromoRepository } from './promo.repository';
import { AppError, NotFoundError } from '../../core/errors/AppError';

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

  createPromo(data: Parameters<PromoRepository['create']>[0]) {
    return this.promoRepo.create(data);
  }
}
