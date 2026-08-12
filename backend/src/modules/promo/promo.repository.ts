import { prisma } from '../../config/prisma';
import { Prisma } from '@prisma/client';

export class PromoRepository {
  findActiveByCode(code: string) {
    return prisma.promo.findFirst({
      where: { code: code.toUpperCase(), isActive: true },
    });
  }

  listActive() {
    return prisma.promo.findMany({
      where: {
        isActive: true,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  incrementUsage(id: string) {
    return prisma.promo.update({
      where: { id },
      data: { usedCount: { increment: 1 } },
    });
  }

  // 🆕 FIX "Promo race": UPDATE atomik dengan syarat kuota di WHERE
  // clause yang sama -- satu statement SQL tunggal, dieksekusi Postgres
  // secara serial per baris (row-level lock), jadi TIDAK ADA celah
  // check-then-act sama sekali. Kalau dua request nyaris bersamaan
  // sama-sama mencoba pakai promo yang sisa kuotanya 1, HANYA SATU yang
  // updateMany-nya mengenai baris (count=1), yang satu lagi count=0
  // karena begitu baris pertama ter-update, kondisi usedCount<quota di
  // WHERE sudah tidak terpenuhi lagi untuk request kedua.
  // 🆕 FIX "Financial transaction boundary": menerima `tx` opsional
  // (Prisma.TransactionClient) supaya bisa dipanggil DALAM transaksi DB
  // yang sama dengan order.create() -- kalau order gagal dibuat setelah
  // reservasi promo berhasil, keduanya ROLLBACK bersamaan (kuota promo
  // TIDAK jadi "terbakar" percuma untuk order yang gagal dibuat).
  async tryIncrementUsage(id: string, quota: number, tx?: Prisma.TransactionClient): Promise<boolean> {
    const db = tx ?? prisma;
    if (quota <= 0) {
      // quota<=0 berarti "tanpa batas" di validateAndPreview -- tetap
      // increment untuk statistik, tidak ada syarat yang bisa gagal.
      const result = await db.promo.updateMany({
        where: { id },
        data: { usedCount: { increment: 1 } },
      });
      return result.count > 0;
    }

    const result = await db.promo.updateMany({
      where: { id, usedCount: { lt: quota } },
      data: { usedCount: { increment: 1 } },
    });
    return result.count > 0; // false = kuota sudah habis duluan (kalah race)
  }

  create(data: {
    code: string;
    type: 'PERCENTAGE' | 'FIXED';
    value: number;
    maxDiscount?: number;
    minOrderPrice?: number;
    quota?: number;
    expiresAt?: string;
  }) {
    return prisma.promo.create({
      data: {
        code: data.code.toUpperCase(),
        type: data.type,
        value: data.value,
        maxDiscount: data.maxDiscount,
        minOrderPrice: data.minOrderPrice ?? 0,
        quota: data.quota ?? 0,
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
      },
    });
  }
}
