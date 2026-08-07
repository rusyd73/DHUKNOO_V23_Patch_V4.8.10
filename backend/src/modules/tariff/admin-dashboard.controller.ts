import { Response } from "express";
import { AuthenticatedRequest } from "../../core/middleware/auth.middleware";
import { TariffRepository } from "./tariff.repository";
import { AppError } from "../../core/errors/AppError";
import { logger } from "../../config/logger";

export class AdminDashboardController {
  private tariffRepo = new TariffRepository();

  /*
  |--------------------------------------------------------------------------
  | GET /api/tariff/analytics/dashboard - Live Business Analytics
  |--------------------------------------------------------------------------
  | Menarik rekapitulasi data volume order, status perjalanan, serta mutasi
  | buku besar keuangan (ledger) untuk grafik dashboard admin panel.
  */
  getSummary = async (req: AuthenticatedRequest, res: Response) => {
    try {
      // Membaca parameter ?range=daily atau weekly atau monthly (Default: daily)
      const range = (req.query.range as "daily" | "weekly" | "monthly") || "daily";

      if (!["daily", "weekly", "monthly"].includes(range)) {
        return res.status(400).json({ 
          error: "Parameter rentang waktu tidak valid! Gunakan opsi: daily, weekly, atau monthly." 
        });
      }

      // Jalankan kueri agregasi super cepat di tingkat database PostgreSQL via Repository
      const summary = await this.tariffRepo.getDashboardSummary(range);

      // Kalkulasi KPI Highlights (Ringkasan Cepat) untuk widget kartu di UI Frontend Admin
      const completedOrdersCount = summary.totalOrders;

      // PERBAIKAN: sebelumnya dua angka ini hardcoded 0 (belum sempat dihitung).
      // Sekarang diambil langsung dari getDashboardSummary (agregasi tabel Transaction).
      const totalPlatformCommissionRupiah = summary.totalPlatformCommissionRupiah;

      const totalDriverEarningsRupiah = summary.totalDriverEarningRupiah;

      return res.status(200).json({
        success: true,
        highlights: {
          completedOrdersCount,
          totalCommissionRupiah: totalPlatformCommissionRupiah,
          totalDriverEarningRupiah: totalDriverEarningsRupiah,
        },
        data: summary,
      });
    } catch (err: any) {
      logger.error("AdminDashboardController.getSummary error: %s", err.message);
      return res.status(500).json({ 
        error: "Gagal merangkum data analitik keuangan dan statistik order dashboard admin." 
      });
    }
  };
}
