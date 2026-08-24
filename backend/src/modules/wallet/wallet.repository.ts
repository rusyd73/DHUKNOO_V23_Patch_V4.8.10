import { Prisma, TransactionType } from '@prisma/client';
import { prisma } from '../../config/prisma';

export class WalletRepository {
  findByUserId(userId: string) {
    return prisma.wallet.findUnique({ where: { userId } });
  }

  createForUser(userId: string) {
    return prisma.wallet.create({ data: { userId, balance: 0, earningsBalance: 0 } });
  }

  async findOrCreateByUserId(userId: string) {
    const existing = await this.findByUserId(userId);
    if (existing) return existing;
    return this.createForUser(userId);
  }

  listTransactions(walletId: string, limit = 50, offset = 0) {
    return prisma.transaction.findMany({
      where: { walletId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });
  }

  findTransactionByIdempotencyKey(idempotencyKey: string) {
    return prisma.transaction.findUnique({ where: { idempotencyKey } });
  }

  /**
   * Adds (or subtracts, with a negative amount) `delta` to a wallet's balance and
   * records the ledger entry, atomically, inside an existing transaction client.
   * Throws if the resulting balance would go negative.
   *
   * AUDIT NOTE (concurrency): versi sebelumnya membaca saldo dulu
   * (`findUniqueOrThrow`) lalu menulis nilai baru yang sudah dihitung di Node
   * (`update({ data: { balance: newBalance } })`) — pola read-then-write klasik
   * yang RENTAN LOST UPDATE. Dua transaksi yang menyentuh wallet sama nyaris
   * bersamaan bisa saling menimpa saldo satu sama lain walau sudah dibungkus
   * `prisma.$transaction()` — isolation level default Postgres (Read Committed)
   * TIDAK mencegah anomali ini tanpa row lock eksplisit.
   *
   * Diperbaiki dengan `updateMany` + guard kondisi pada WHERE clause: update
   * hanya berhasil (count === 1) kalau saldo saat itu MASIH cukup untuk didebit,
   * dievaluasi atomic oleh Postgres sendiri (setara `SELECT ... FOR UPDATE`
   * tanpa round-trip tambahan).
   */
  async applyDelta(
    tx: Prisma.TransactionClient,
    walletId: string,
    delta: Prisma.Decimal.Value,
    type: TransactionType,
    description: string,
    orderId?: string,
    idempotencyKey?: string
  ) {
    const deltaDecimal = new Prisma.Decimal(delta);
    const minRequiredBalance = deltaDecimal.isNegative() ? deltaDecimal.abs() : new Prisma.Decimal(0);

    const isEarningCredit = deltaDecimal.isPositive() && (type === 'EARNING' || type === 'MERCHANT_EARNING');
    const isEarningRefund = deltaDecimal.isPositive() && type === 'WITHDRAWAL_REFUND';
    // earningsBalance adalah akumulasi penghasilan yang dapat dicairkan,
    // bukan cermin semua debit saldo operasional. Komisi CASH/top-up expense
    // tetap mengurangi balance, tetapi tidak menghapus catatan penghasilan.
    // Penghasilan hanya berkurang ketika benar-benar di-HOLD untuk withdrawal
    // (alur tersebut mengubah kedua kolom secara eksplisit di WalletService).
    const earningsDelta = isEarningCredit || isEarningRefund ? deltaDecimal : new Prisma.Decimal(0);

    // Satu statement atomic. TOPUP/ADMIN_CREDIT dan debit operasional tidak
    // mengubah earningsBalance; available withdrawal tetap dibatasi oleh
    // min(earningsBalance, balance - minimumRetained).
    const updatedRows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      UPDATE "Wallet"
      SET
        "balance" = "balance" + ${deltaDecimal},
        "earningsBalance" = GREATEST(0, "earningsBalance" + ${earningsDelta}),
        "updatedAt" = NOW()
      WHERE "id" = ${walletId}
        AND "balance" >= ${minRequiredBalance}
      RETURNING "id"
    `);

    if (updatedRows.length === 0) {
      const exists = await tx.wallet.findUnique({ where: { id: walletId }, select: { id: true } });
      if (!exists) {
        throw new Error('Wallet tidak ditemukan.');
      }
      throw new Error('Saldo wallet tidak mencukupi untuk transaksi ini!');
    }

    const updatedWallet = await tx.wallet.findUniqueOrThrow({ where: { id: walletId } });

    const transaction = await tx.transaction.create({
      data: {
        walletId,
        amount: deltaDecimal,
        type,
        description,
        orderId,
        idempotencyKey,
      },
    });

    return { wallet: updatedWallet, transaction };
  }

  runInTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) {
    return prisma.$transaction(fn);
  }
}
