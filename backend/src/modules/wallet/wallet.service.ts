import { WalletRepository } from './wallet.repository';
import { AppError, NotFoundError } from '../../core/errors/AppError';

export class WalletService {
  private walletRepo = new WalletRepository();

  async getBalance(userId: string) {
    const wallet = await this.walletRepo.findOrCreateByUserId(userId);
    return wallet;
  }

  async getTransactionHistory(userId: string, limit = 50, offset = 0) {
    const wallet = await this.walletRepo.findOrCreateByUserId(userId);
    const transactions = await this.walletRepo.listTransactions(wallet.id, limit, offset);
    return { wallet, transactions };
  }

  async topup(userId: string, amount: number) {
    if (amount < 5000) {
      throw new AppError('Nominal top-up minimal adalah Rp 5.000!', 400);
    }

    const wallet = await this.walletRepo.findOrCreateByUserId(userId);

    const result = await this.walletRepo.runInTransaction(async (tx) => {
      return this.walletRepo.applyDelta(
        tx,
        wallet.id,
        amount,
        'TOPUP',
        `Top-up saldo sebesar Rp${amount.toLocaleString('id-ID')}`
      );
    });

    return result;
  }
}
