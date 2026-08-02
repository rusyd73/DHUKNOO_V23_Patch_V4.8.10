import { MerchantRepository } from './merchant.repository';
import { NotFoundError, ForbiddenError } from '../../core/errors/AppError';

export class MerchantService {
  private merchantRepo = new MerchantRepository();

  list(filter?: { category?: string; isOpen?: boolean }) {
    return this.merchantRepo.list(filter);
  }

  async getDetail(id: string) {
    const merchant = await this.merchantRepo.findById(id);
    if (!merchant) {
      throw new NotFoundError('Merchant tidak ditemukan!');
    }
    return merchant;
  }

  async getMine(ownerId: string) {
    const merchant = await this.merchantRepo.findByOwnerId(ownerId);
    if (!merchant) {
      throw new NotFoundError('Anda belum memiliki toko terdaftar!');
    }
    return merchant;
  }

  /**
   * Memastikan `requesterId` berhak mengelola merchant `merchantId`.
   * ADMIN boleh mengelola merchant mana pun; MERCHANT hanya boleh mengelola tokonya sendiri.
   */
  private async assertCanManage(merchantId: string, requesterId: string, requesterRole: string) {
    const merchant = await this.getDetail(merchantId);
    if (requesterRole === 'ADMIN') return merchant;
    if (requesterRole === 'MERCHANT' && merchant.ownerId === requesterId) return merchant;
    throw new ForbiddenError('Anda tidak berhak mengelola toko ini!');
  }

  create(data: Parameters<MerchantRepository['create']>[0]) {
    return this.merchantRepo.create(data);
  }

  async update(id: string, requesterId: string, requesterRole: string, data: Parameters<MerchantRepository['update']>[1]) {
    await this.assertCanManage(id, requesterId, requesterRole);
    return this.merchantRepo.update(id, data);
  }

  async addMenuItem(merchantId: string, requesterId: string, requesterRole: string, data: Parameters<MerchantRepository['addMenuItem']>[1]) {
    await this.assertCanManage(merchantId, requesterId, requesterRole);
    return this.merchantRepo.addMenuItem(merchantId, data);
  }

  async updateMenuItem(itemId: string, requesterId: string, requesterRole: string, data: Parameters<MerchantRepository['updateMenuItem']>[1]) {
    const item = await this.merchantRepo.findMenuItemById(itemId);
    if (!item) {
      throw new NotFoundError('Menu item tidak ditemukan!');
    }
    await this.assertCanManage(item.merchantId, requesterId, requesterRole);
    return this.merchantRepo.updateMenuItem(itemId, data);
  }
}
