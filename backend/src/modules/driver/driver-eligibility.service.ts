// backend/src/modules/driver/driver-eligibility.service.ts
//
// 🆕 SATUKAN DRIVER ELIGIBILITY: sebelumnya ada TIGA implementasi terpisah
// untuk "apakah driver ini boleh menerima order X", masing-masing dengan
// kriteria yang TIDAK KONSISTEN:
//
//   1. Manual accept (driver/routes/job.routes.ts)  -- cek deposit ADA,
//      tapi pengecualian klasifikasi kendaraan HANYA untuk order SEND
//      (order MART ikut wajib cocok serviceType, padahal seharusnya tidak).
//   2. Dispatch Engine (dispatch/dispatch.service.ts) -- pengecualian
//      klasifikasi BENAR (SEND+MART), tapi TIDAK PERNAH cek deposit sama
//      sekali.
//   3. Auto-Accept saat order dibuat (order/order.service.ts
//      tryAutoAcceptOnCreation) -- pengecualian klasifikasi BENAR
//      (SEND+MART), tapi JUGA TIDAK PERNAH cek deposit.
//
// Akibat nyata dari inkonsistensi ini:
//   - Bug fungsional: driver bisa ditawari/auto-accept order MART lewat
//     jalur #2/#3, tapi kalau mereka coba klaim order MART SERUPA lewat
//     jalur manual (#1), ditolak salah dengan pesan "jenis kendaraan tidak
//     cocok" -- padahal MART memang seharusnya tidak perlu cocok.
//   - Celah integritas keuangan: driver dengan saldo deposit Rp0 (atau di
//     bawah minimum) TIDAK BISA menerima order lewat jalur manual (#1,
//     ditolak duluan), TAPI TETAP BISA menerima order lewat Dispatch
//     Engine atau Auto-Accept (#2/#3, tidak ada gerbang deposit sama
//     sekali) -- driver bisa terus dapat order, kumpulkan cash dari
//     customer, lalu gagal setor komisi platform karena depositnya memang
//     sengaja dikosongkan.
//
// Modul ini adalah SATU-SATUNYA sumber kebenaran untuk kedua aturan itu,
// dipakai oleh ketiga jalur di atas.
import { prisma } from '../../config/prisma';
import { TariffEngineService } from '../tariff/tariff.service';

// Tipe order yang TIDAK memerlukan kecocokan serviceType terdaftar driver --
// siapa pun driver (BIKE/CAR) yang online & memenuhi syarat lain boleh
// menerima order jenis ini.
const SERVICE_TYPE_MATCH_EXEMPT = new Set(['SEND', 'MART']);

export class DriverEligibilityService {
  private tariffEngine = new TariffEngineService();

  /**
   * Apakah serviceType order ini butuh kecocokan persis dengan serviceType
   * yang terdaftar di profil driver? (BIKE order -> wajib driver BIKE, dst)
   * Order SEND & MART dikecualikan dari aturan ini.
   */
  matchesServiceType(orderServiceType: string, driverServiceType: string | null | undefined): boolean {
    if (SERVICE_TYPE_MATCH_EXEMPT.has(orderServiceType)) {
      return true;
    }
    return orderServiceType === driverServiceType;
  }

  /**
   * Fragmen where-clause Prisma dasar untuk query kandidat driver (dipakai
   * findMany). TIDAK termasuk pengecekan deposit -- itu butuh query wallet
   * terpisah, lihat filterByDeposit()/checkDeposit() di bawah.
   */
  baseWhereClause(orderServiceType: string) {
    return {
      isOnline: true,
      isVerified: true,
      latitude: { not: null },
      longitude: { not: null },
      ...(SERVICE_TYPE_MATCH_EXEMPT.has(orderServiceType) ? {} : { serviceType: orderServiceType as any }),
      // BEKUKAN driver dari order baru selama ada order CASH yang sudah
      // COMPLETED tapi belum dikonfirmasi/disetor (isPaid masih false).
      orders: {
        none: {
          status: 'COMPLETED' as const,
          paymentMethod: 'CASH' as const,
          isPaid: false,
        },
      },
    };
  }

  /**
   * Cek gerbang deposit untuk SATU driver (dipakai jalur imperative seperti
   * manual accept, yang sudah punya satu driver spesifik di tangan).
   */
  async checkDeposit(userId: string): Promise<{ eligible: boolean; currentBalance: number; minimumDeposit: number }> {
    const [wallet, minimumDeposit] = await Promise.all([
      prisma.wallet.findUnique({ where: { userId } }),
      this.tariffEngine.getMinimumDriverDeposit(),
    ]);
    const currentBalance = Number(wallet?.balance ?? 0);
    return { eligible: currentBalance >= minimumDeposit, currentBalance, minimumDeposit };
  }

  /**
   * Filter BATCH kandidat (dari findMany) berdasarkan gerbang deposit --
   * dipakai Dispatch Engine & Auto-Accept, yang bekerja dengan daftar
   * kandidat sekaligus, bukan satu driver. Satu query wallet untuk semua
   * kandidat (bukan N+1) supaya tetap ringan dipanggil setiap order baru.
   */
  async filterByDeposit<T extends { userId: string }>(candidates: T[]): Promise<T[]> {
    if (candidates.length === 0) return [];

    const [wallets, minimumDeposit] = await Promise.all([
      prisma.wallet.findMany({
        where: { userId: { in: candidates.map((c) => c.userId) } },
        select: { userId: true, balance: true },
      }),
      this.tariffEngine.getMinimumDriverDeposit(),
    ]);

    const balanceByUserId = new Map(wallets.map((w) => [w.userId, Number(w.balance)]));
    return candidates.filter((c) => (balanceByUserId.get(c.userId) ?? 0) >= minimumDeposit);
  }
}

export const driverEligibilityService = new DriverEligibilityService();
