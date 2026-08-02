import { Response } from 'express';
import path from 'path';
import fs from 'fs';
import { AuthenticatedRequest } from '../../core/middleware/auth.middleware';
import { buildAdminRecap, RecapTimeframe } from '../admin/admin-recap.service';
import { buildRecapExcel, buildRecapPdf } from '../admin/admin-export.service';
import { SocketService } from '../../websocket/socket';
import { UPLOAD_DIR_ABSOLUTE, UPLOADS_PUBLIC_PATH } from '../upload/upload.config';
import { logger } from '../../config/logger';

const REPORTS_SUBDIR = 'reports';
const REPORTS_DIR = path.join(UPLOAD_DIR_ABSOLUTE, REPORTS_SUBDIR);

if (!fs.existsSync(REPORTS_DIR)) {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

/**
 * Laporan ASYNC — endpoint langsung balas 202 (diterima, sedang diproses),
 * lalu file di-generate di BACKGROUND (tidak memblokir request), dan client
 * diberi tahu lewat Socket.IO (event `report_ready`) begitu file siap
 * diunduh. Cocok untuk laporan yang berpotensi berat/lama (rentang waktu
 * besar, banyak baris) — beda dengan endpoint export sinkron di
 * /api/admin/export/(excel|pdf) yang langsung mengembalikan file dalam satu
 * response (cocok untuk laporan kecil/cepat).
 */
export class ReportController {
  triggerReport = async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.id;
    const reportType = req.params.type; // mis. 'recap' — kategori laporan
    const format = (req.query.format as 'pdf' | 'excel') || 'excel';
    const timeframe = ((req.query.timeframe as string) || 'daily') as RecapTimeframe;

    // Balas SEGERA — proses generate berjalan di background setelah ini.
    res.status(202).json({
      message: 'Permintaan laporan diterima, sedang diproses. Anda akan diberi tahu lewat notifikasi realtime begitu file siap diunduh.',
      reportType,
      format,
    });

    // PENTING: base URL diambil SEKARANG (selagi req masih valid) untuk
    // membangun downloadUrl ABSOLUT nanti — bukan path relatif. Pelajaran dari
    // bug upload.routes.ts sebelumnya: path relatif ("/uploads/...") yang
    // dibuka dari origin frontend (Vite, localhost:5173) akan salah arah,
    // BUKAN ke backend (localhost:3000) tempat file itu sebenarnya di-serve.
    const backendBaseUrl = `${req.protocol}://${req.get('host')}`;

    // Best-effort background job — kegagalan di sini TIDAK mempengaruhi
    // response yang sudah terkirim di atas, cukup dicatat ke log.
    this.generateInBackground(userId, reportType, format, timeframe, backendBaseUrl).catch((err) => {
      logger.error(`[ReportController] Gagal generate laporan ${reportType}/${format}: ${err.message}`);
    });
  };

  private async generateInBackground(
    userId: string,
    reportType: string,
    format: 'pdf' | 'excel',
    timeframe: RecapTimeframe,
    backendBaseUrl: string
  ) {
    const recap = await buildAdminRecap(timeframe);
    const buffer = format === 'excel' ? await buildRecapExcel(recap) : await buildRecapPdf(recap);

    const filename = `${reportType}-${timeframe}-${Date.now()}.${format === 'excel' ? 'xlsx' : 'pdf'}`;
    const filepath = path.join(REPORTS_DIR, filename);
    fs.writeFileSync(filepath, buffer);

    const downloadUrl = `${backendBaseUrl}${UPLOADS_PUBLIC_PATH}/${REPORTS_SUBDIR}/${filename}`;

    SocketService.emitToUser(userId, 'report_ready', {
      reportType,
      format,
      downloadUrl,
    });
  }
}
