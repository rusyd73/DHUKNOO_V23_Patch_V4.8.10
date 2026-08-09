import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import { authenticateToken, AuthenticatedRequest, authorizeRoles } from '../../core/middleware/auth.middleware';
import { prisma } from '../../config/prisma';
import { AuditLogger } from '../../core/logging/audit.logger';
import { validateBody } from '../../core/middleware/validation.middleware';
import { reviewDriverDocumentSchema, createAdminSchema, adminWalletCreditSchema } from '../../core/validation/schemas';
import { buildAdminRecap, RecapTimeframe } from './admin-recap.service';
import { buildRecapExcel, buildRecapPdf } from './admin-export.service';
import { SocketService } from '../../websocket/socket';
import { RedisService } from '../../config/redis';
import { AppError } from '../../core/errors/AppError';
import { WalletRepository } from '../wallet/wallet.repository';

const router = Router();

// GET /api/admin/dashboard - Fetch global platform statistics and lists
router.get(
  '/dashboard',
  authenticateToken as any,
  authorizeRoles('ADMIN') as any,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const totalCustomers = await prisma.customerProfile.count();
      const totalDrivers = await prisma.driverProfile.count();
      const totalOrders = await prisma.order.count();

      // Calculate total revenue from COMPLETED orders
      const completedOrders = await prisma.order.findMany({
        where: { status: 'COMPLETED' },
        select: { price: true },
      });

      const totalRevenue = completedOrders.reduce((sum, o) => sum + Number(o.price), 0);

      // Get all drivers with their associated user details and documents
      const drivers = await prisma.driverProfile.findMany({
        include: {
          user: {
            select: {
              fullName: true,
              email: true,
            },
          },
          documents: true,
        },
        orderBy: { createdAt: 'desc' },
      });

      // Get latest 20 audit logs
      const logs = await prisma.activityLog.findMany({
        include: {
          user: {
            select: {
              fullName: true,
              email: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      });

      return res.status(200).json({
        stats: {
          totalCustomers,
          totalDrivers,
          totalOrders,
          totalRevenue,
        },
        drivers,
        logs,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }
);

// POST /api/admin/drivers/:driverProfileId/verify - Verify driver profile
router.post(
  '/drivers/:driverProfileId/verify',
  authenticateToken as any,
  authorizeRoles('ADMIN') as any,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const adminId = req.user?.id;
      const { driverProfileId } = req.params;

      if (!adminId) {
        return res.status(401).json({ error: 'Tidak terautentikasi' });
      }

      const updated = await prisma.driverProfile.update({
        where: { id: driverProfileId },
        data: { isVerified: true },
        include: { user: { select: { fullName: true } } },
      });

      await AuditLogger.log(
        adminId,
        'ADMIN_VERIFY_DRIVER',
        `Memverifikasi kemitraan pengemudi: ${updated.user.fullName} (${updated.vehiclePlate})`
      );

      return res.status(200).json({
        message: `Kemitraan driver ${updated.user.fullName} berhasil disetujui (VERIFIED)!`,
        driver: updated,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }
);

// POST /api/admin/drivers/:driverProfileId/suspend - Suspend / Unverify driver profile
router.post(
  '/drivers/:driverProfileId/suspend',
  authenticateToken as any,
  authorizeRoles('ADMIN') as any,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const adminId = req.user?.id;
      const { driverProfileId } = req.params;

      if (!adminId) {
        return res.status(401).json({ error: 'Tidak terautentikasi' });
      }

      const updated = await prisma.driverProfile.update({
        where: { id: driverProfileId },
        data: { isVerified: false, isOnline: false },
        include: { user: { select: { fullName: true } } },
      });

      await AuditLogger.log(
        adminId,
        'ADMIN_SUSPEND_DRIVER',
        `Membatalkan verifikasi / menangguhkan pengemudi: ${updated.user.fullName}`
      );

      return res.status(200).json({
        message: `Kemitraan driver ${updated.user.fullName} ditangguhkan harian!`,
        driver: updated,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }
);

// ── PERBAIKAN #3: Otorisasi Admin — Nonaktifkan/Aktifkan Kembali User ──────

// GET /api/admin/users - daftar semua user (Customer/Driver/Merchant/Admin)
// beserta status aktif/nonaktifnya, untuk dipilih Admin di panel manajemen user.
router.get(
  '/users',
  authenticateToken as any,
  authorizeRoles('ADMIN') as any,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const roleFilter = req.query.role as string | undefined;

      const users = await prisma.user.findMany({
        where: roleFilter ? { role: roleFilter as any } : undefined,
        select: {
          id: true,
          email: true,
          fullName: true,
          role: true,
          isActive: true,
          deactivatedAt: true,
          deactivationReason: true,
          createdAt: true,
          customerProfile: { select: { phoneNumber: true } },
          driverProfile: { select: { phoneNumber: true, isVerified: true } },
          merchant: { select: { name: true, isOpen: true } },
        },
        orderBy: { createdAt: 'desc' },
      });

      return res.status(200).json({ users });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Gagal mengambil daftar pengguna.' });
    }
  }
);

// POST /api/admin/users/:userId/deactivate - nonaktifkan (remove akses) akun user.
// User TIDAK dihapus dari database (data order/wallet/riwayat tetap utuh) —
// hanya diblokir login & di-force-logout dari sesi yang sedang aktif.
router.post(
  '/users/:userId/deactivate',
  authenticateToken as any,
  authorizeRoles('ADMIN') as any,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const adminId = req.user!.id;
      const { userId } = req.params;
      const { reason } = req.body || {};

      const target = await prisma.user.findUnique({ where: { id: userId } });
      if (!target) {
        return res.status(404).json({ error: 'Pengguna tidak ditemukan.' });
      }
      if (target.role === 'ADMIN') {
        return res.status(403).json({ error: 'Akun sesama Admin tidak bisa dinonaktifkan lewat panel ini.' });
      }
      if (target.id === adminId) {
        return res.status(400).json({ error: 'Anda tidak bisa menonaktifkan akun Anda sendiri.' });
      }

      const updated = await prisma.user.update({
        where: { id: userId },
        data: {
          isActive: false,
          refreshToken: null,
          deactivatedAt: new Date(),
          deactivatedBy: adminId,
          deactivationReason: reason || null,
        },
      });

      // Hapus cache isActive (lihat auth.middleware.ts) supaya efek nonaktif
      // langsung terasa di request berikutnya, bukan menunggu TTL cache 30 detik.
      await RedisService.del(`auth:isActive:${userId}`);

      // Paksa logout real-time kalau user sedang online (WebSocket) —
      // supaya efeknya langsung terasa, bukan menunggu access token expired.
      try {
        SocketService.emitToUser(userId, 'account_deactivated', {
          reason: reason || 'Dinonaktifkan oleh Admin.',
        });
      } catch {
        // Socket.IO belum siap / user sedang tidak online — abaikan.
      }

      await AuditLogger.log(
        adminId,
        'ADMIN_DEACTIVATE_USER',
        `Menonaktifkan akun ${updated.fullName} (${updated.email}, role: ${updated.role})${reason ? ` — Alasan: ${reason}` : ''}`
      );

      return res.status(200).json({
        message: `Akun ${updated.fullName} berhasil dinonaktifkan.`,
        user: { id: updated.id, email: updated.email, fullName: updated.fullName, isActive: updated.isActive },
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Gagal menonaktifkan akun pengguna.' });
    }
  }
);

// POST /api/admin/users/:userId/reactivate - aktifkan kembali akun user
// (mis. atas permintaan user yang mengajukan banding ke Customer Service).
router.post(
  '/users/:userId/reactivate',
  authenticateToken as any,
  authorizeRoles('ADMIN') as any,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const adminId = req.user!.id;
      const { userId } = req.params;

      const target = await prisma.user.findUnique({ where: { id: userId } });
      if (!target) {
        return res.status(404).json({ error: 'Pengguna tidak ditemukan.' });
      }

      const updated = await prisma.user.update({
        where: { id: userId },
        data: {
          isActive: true,
          deactivatedAt: null,
          deactivatedBy: null,
          deactivationReason: null,
        },
      });

      // Hapus cache isActive (lihat catatan yang sama di endpoint deactivate).
      await RedisService.del(`auth:isActive:${userId}`);

      await AuditLogger.log(
        adminId,
        'ADMIN_REACTIVATE_USER',
        `Mengaktifkan kembali akun ${updated.fullName} (${updated.email}, role: ${updated.role}) atas permintaan pengguna.`
      );

      return res.status(200).json({
        message: `Akun ${updated.fullName} berhasil diaktifkan kembali.`,
        user: { id: updated.id, email: updated.email, fullName: updated.fullName, isActive: updated.isActive },
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Gagal mengaktifkan kembali akun pengguna.' });
    }
  }
);

// GET /api/admin/logs - Fetch global platform logs directly
router.get(
  '/logs',
  authenticateToken as any,
  authorizeRoles('ADMIN') as any,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const logs = await prisma.activityLog.findMany({
        include: {
          user: {
            select: {
              fullName: true,
              email: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      return res.status(200).json({ logs });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }
);

// ── Top-Up Deposit Review (Customer & Driver) ──────────────────────────────
router.get(
  '/topup-requests/pending',
  authenticateToken as any,
  authorizeRoles('ADMIN') as any,
  async (_req: AuthenticatedRequest, res: Response) => {
    try {
      // 🆕 OPTIMASI PERFORMA: sebelumnya query ini TIDAK DIBATASI sama sekali
      // -- kalau antrean top-up yang belum direview menumpuk (mis. CS libur,
      // lonjakan promo), semuanya dikirim ke browser sekaligus dan di-render
      // sebagai kartu (dengan thumbnail gambar) tanpa virtualisasi -- berat
      // dan lambat. Dibatasi 100 terlama (FIFO, paling butuh direview
      // duluan), dengan flag `truncated` supaya Admin tahu masih ada
      // antrean di belakangnya walau tidak semuanya tampil sekaligus.
      const TAKE_LIMIT = 100;
      const [topupRequests, totalPending] = await Promise.all([
        prisma.topupRequest.findMany({
          where: { status: 'PENDING_REVIEW' },
          include: {
            user: {
              select: {
                id: true,
                fullName: true,
                email: true,
                role: true,
                // User tidak punya kolom telepon sendiri — nomor telepon disimpan di
                // level profile (CustomerProfile/DriverProfile). Request top-up bisa
                // datang dari salah satu role, jadi ambil dari yang mana pun yang ada.
                customerProfile: { select: { phoneNumber: true } },
                driverProfile: { select: { phoneNumber: true } },
              },
            },
          },
          orderBy: { createdAt: 'asc' },
          take: TAKE_LIMIT,
        }),
        prisma.topupRequest.count({ where: { status: 'PENDING_REVIEW' } }),
      ]);
      return res.status(200).json({
        topupRequests,
        totalPending,
        truncated: totalPending > TAKE_LIMIT,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Gagal mengambil daftar permintaan top-up.' });
    }
  }
);

router.post(
  '/topup-requests/:id/review',
  authenticateToken as any,
  authorizeRoles('ADMIN') as any,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const adminId = req.user!.id;
      const { id } = req.params;
      const { status, reviewNote } = req.body;

      if (!['APPROVED', 'REJECTED'].includes(status)) {
        return res.status(400).json({ error: 'Status harus APPROVED atau REJECTED.' });
      }

      const topupReq = await prisma.topupRequest.findUnique({ where: { id } });
      if (!topupReq) {
        return res.status(404).json({ error: 'Permintaan top-up tidak ditemukan.' });
      }

      if (topupReq.status !== 'PENDING_REVIEW') {
        return res.status(400).json({ error: 'Permintaan top-up ini sudah pernah diproses.' });
      }

      const updated = await prisma.topupRequest.update({
        where: { id },
        data: { status, reviewedBy: adminId, reviewedAt: new Date(), reviewNote },
      });

      if (status === 'APPROVED') {
        if (Number(topupReq.amount) < 5000) {
          return res.status(400).json({
            error: 'Permintaan top-up ini bernilai di bawah Rp 5.000 dan tidak dapat disetujui Admin!',
          });
        }
        const WalletServiceModule = await import('../wallet/wallet.service');
        const walletService = new WalletServiceModule.WalletService();
        await walletService.topup(topupReq.userId, Number(topupReq.amount));
      }

      await AuditLogger.log(adminId, 'TOPUP_REQUEST_REVIEWED', `Top-up #${id} status: ${status}`);

      return res.status(200).json({
        message: status === 'APPROVED' ? 'Top-up disetujui! Saldo user berhasil bertambah.' : 'Top-up telah ditolak.',
        topupRequest: updated,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Gagal meninjau permintaan top-up.' });
    }
  }
);


// ── Verifikasi Dokumen Driver (KTP+selfie, STNK) ──────────────────────────
router.get(
  '/driver-documents/pending',
  authenticateToken as any,
  authorizeRoles('ADMIN') as any,
  async (_req: AuthenticatedRequest, res: Response) => {
    try {
      const TAKE_LIMIT = 100;
      const [documents, totalPending] = await Promise.all([
        prisma.driverDocument.findMany({
          where: { status: 'PENDING_REVIEW' },
          include: {
            driver: { include: { user: { select: { fullName: true, email: true } } } },
          },
          orderBy: { createdAt: 'asc' },
          take: TAKE_LIMIT,
        }),
        prisma.driverDocument.count({ where: { status: 'PENDING_REVIEW' } }),
      ]);
      return res.status(200).json({ documents, totalPending, truncated: totalPending > TAKE_LIMIT });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Gagal mengambil daftar dokumen.' });
    }
  }
);

router.get(
  '/driver-documents/:documentId/review',
  authenticateToken as any,
  authorizeRoles('ADMIN') as any,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { documentId } = req.params;
      const document = await prisma.driverDocument.findUnique({
        where: { id: documentId },
        include: { driver: { include: { user: true } } },
      });
      if (!document) {
        return res.status(404).json({ error: 'Dokumen driver tidak ditemukan!' });
      }
      return res.status(200).json({ document });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Gagal mengambil detail dokumen.' });
    }
  }
);

router.post(
  '/driver-documents/:documentId/review',
  authenticateToken as any,
  authorizeRoles('ADMIN') as any,
  validateBody(reviewDriverDocumentSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const adminId = req.user!.id;
      const { documentId } = req.params;
      const { status, reviewNote } = req.body;

      const document = await prisma.driverDocument.update({
        where: { id: documentId },
        data: { status, reviewedBy: adminId, reviewedAt: new Date(), reviewNote },
      });

      // PERBAIKAN: sebelumnya isVerified langsung jadi true begitu SATU dokumen
      // saja disetujui — driver bisa online walau KTP/SIM/STNK belum lengkap
      // semuanya disetujui. Sekarang WAJIB ketiga jenis dokumen (KTP_SELFIE,
      // STNK, SIM) berstatus APPROVED baru isVerified jadi true.
      const REQUIRED_DOCUMENT_TYPES = ['KTP_SELFIE', 'STNK', 'SIM'];
      const allDocs = await prisma.driverDocument.findMany({
        where: { driverId: document.driverId },
        select: { type: true, status: true },
      });
      const allApproved = REQUIRED_DOCUMENT_TYPES.every((type) =>
        allDocs.some((d) => d.type === type && d.status === 'APPROVED')
      );

      await prisma.driverProfile.update({
        where: { id: document.driverId },
        data: { isVerified: allApproved },
      });

      const remainingTypes = REQUIRED_DOCUMENT_TYPES.filter(
        (type) => !allDocs.some((d) => d.type === type && d.status === 'APPROVED')
      );

      // BARU: kalau verifikasi jadi TIDAK lengkap lagi (mis. admin menolak
      // dokumen yang tadinya sudah disetujui, atau salah satu dokumen belum/
      // tidak lagi APPROVED), paksa driver OFFLINE SEKARANG JUGA — jangan
      // cuma menahan toggle berikutnya. Tanpa ini, driver yang KEBETULAN
      // sudah online sebelum dokumennya ditolak akan tetap online dan bisa
      // terus menerima order walau syaratnya sudah tidak terpenuhi lagi.
      if (!allApproved) {
        const driverProfile = await prisma.driverProfile.update({
          where: { id: document.driverId },
          data: { isOnline: false },
          select: { userId: true, isOnline: true },
        });
        try {
          SocketService.emitToUser(driverProfile.userId, 'forced_offline', {
            reason: `Verifikasi dokumen belum lengkap (${remainingTypes.join(', ') || '-'}). Anda diset OFFLINE otomatis.`,
          });
        } catch {
          // Socket.IO belum siap — abaikan.
        }
      }

      await AuditLogger.log(adminId, 'DRIVER_DOCUMENT_REVIEWED', `Dokumen #${documentId} ditandai ${status}`);

      return res.status(200).json({
        message: allApproved
          ? `Dokumen ditandai ${status}. Semua dokumen wajib (KTP, STNK, SIM) sudah disetujui — akun driver kini terverifikasi penuh dan bisa online.`
          : `Dokumen ditandai ${status}. Driver belum bisa online — masih menunggu persetujuan: ${remainingTypes.join(', ') || '-'}.`,
        document,
        allApproved,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Gagal meninjau dokumen.' });
    }
  }
);

// ── Commission Audit Platform Endpoint ────────────────────────────────────
router.get(
  '/commission-audit',
  authenticateToken as any,
  authorizeRoles('ADMIN') as any,
  async (_req: AuthenticatedRequest, res: Response) => {
    try {
      const completedOrders = await prisma.order.findMany({
        where: { status: 'COMPLETED' },
        select: { id: true, price: true, discount: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      });

      const feeTx = await prisma.transaction.findMany({
        where: { type: 'PLATFORM_FEE' },
        select: { amount: true, createdAt: true },
      });

      const dailyMap = new Map<string, { totalCommission: number; orderCount: number }>();
      const today = new Date();

      for (let i = 6; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().split('T')[0];
        dailyMap.set(dateStr, { totalCommission: 0, orderCount: 0 });
      }

      feeTx.forEach((tx) => {
        const dateStr = new Date(tx.createdAt).toISOString().split('T')[0];
        if (dailyMap.has(dateStr)) {
          const curr = dailyMap.get(dateStr)!;
          curr.totalCommission += Number(tx.amount);
        }
      });

      completedOrders.forEach((o) => {
        const dateStr = new Date(o.createdAt).toISOString().split('T')[0];
        if (dailyMap.has(dateStr)) {
          const curr = dailyMap.get(dateStr)!;
          curr.orderCount += 1;
          if (feeTx.length === 0) {
            const netPrice = Number(o.price) - Number(o.discount || 0);
            curr.totalCommission += Math.round(netPrice * 0.08);
          }
        }
      });

      const daysOfWeek = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
      const monthsOfYear = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

      const dailyData = Array.from(dailyMap.entries()).map(([dateStr, data]) => {
        const d = new Date(dateStr);
        const dayLabel = `${daysOfWeek[d.getDay()]} ${d.getDate()} ${monthsOfYear[d.getMonth()]}`;
        return {
          date: dateStr,
          dayLabel,
          totalCommission: data.totalCommission,
          orderCount: data.orderCount,
        };
      });

      const totalCommission = dailyData.reduce((acc, item) => acc + item.totalCommission, 0);
      const totalOrdersProcessed = dailyData.reduce((acc, item) => acc + item.orderCount, 0);
      const todayStr = today.toISOString().split('T')[0];
      const todayCommission = dailyMap.get(todayStr)?.totalCommission || 0;
      const averageDaily = Math.round(totalCommission / 7);

      return res.status(200).json({
        summary: {
          totalCommissionEarned: totalCommission,
          todayCommission,
          averageDailyCommission: averageDaily,
          totalOrdersProcessed,
        },
        dailyData,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Gagal mengambil audit komisi platform.' });
    }
  }
);

// ── Rekapitulasi Laporan Platform (Harian, Mingguan, Bulanan) ─────────────
router.get(
  '/recap',
  authenticateToken as any,
  authorizeRoles('ADMIN') as any,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const timeframe = ((req.query.timeframe as string) || 'daily') as RecapTimeframe;
      const recap = await buildAdminRecap(timeframe);
      return res.status(200).json(recap);
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Gagal mengambil rekapitulasi data platform.' });
    }
  }
);

// GET /api/admin/export/excel?timeframe=daily|weekly|monthly
// Rekap LENGKAP (pelanggan, mitra driver+perolehan, transaksi, revenue) dalam
// satu file .xlsx multi-sheet — tanpa batas jumlah baris seperti PDF.
router.get(
  '/export/excel',
  authenticateToken as any,
  authorizeRoles('ADMIN') as any,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const timeframe = ((req.query.timeframe as string) || 'daily') as RecapTimeframe;
      const recap = await buildAdminRecap(timeframe);
      const buffer = await buildRecapExcel(recap);

      await AuditLogger.log(req.user!.id, 'ADMIN_EXPORT_EXCEL', `Export rekap Excel (${timeframe})`);

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="dhuknoo-rekap-${timeframe}-${Date.now()}.xlsx"`);
      return res.status(200).send(buffer);
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Gagal membuat file Excel.' });
    }
  }
);

// GET /api/admin/export/pdf?timeframe=daily|weekly|monthly
// Laporan RINGKASAN siap cetak (KPI + top driver + transaksi terbaru). Untuk
// data mentah lengkap, gunakan export Excel di atas.
router.get(
  '/export/pdf',
  authenticateToken as any,
  authorizeRoles('ADMIN') as any,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const timeframe = ((req.query.timeframe as string) || 'daily') as RecapTimeframe;
      const recap = await buildAdminRecap(timeframe);
      const buffer = await buildRecapPdf(recap);

      await AuditLogger.log(req.user!.id, 'ADMIN_EXPORT_PDF', `Export rekap PDF (${timeframe})`);

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="dhuknoo-rekap-${timeframe}-${Date.now()}.pdf"`);
      return res.status(200).send(buffer);
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Gagal membuat file PDF.' });
    }
  }
);


// 🆕 AUDIT KEAMANAN: satu-satunya jalur (selain seed database awal) untuk
// membuat akun ADMIN baru, sekarang bahwa POST /api/auth/register publik
// tidak lagi menerima role:'ADMIN' (lihat core/validation/schemas.ts
// registerSchema). Dilindungi ganda: authenticateToken (harus login) DAN
// authorizeRoles('ADMIN') (harus admin) -- hanya admin yang sudah ada yang
// bisa membuat admin baru, mata rantai kepercayaan tetap terjaga sejak
// admin pertama dari seed.
router.post(
  '/create-admin',
  authenticateToken as any,
  authorizeRoles('ADMIN') as any,
  validateBody(createAdminSchema) as any,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { email, password, fullName, phone } = req.body;
      const normalizedEmail = email.toLowerCase().trim();

      const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
      if (existing) {
        throw new AppError('Email sudah terdaftar di sistem!', 400);
      }

      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash(password, salt);

      const newAdmin = await prisma.user.create({
        data: {
          email: normalizedEmail,
          passwordHash,
          fullName,
          phone,
          role: 'ADMIN',
        },
        select: { id: true, email: true, fullName: true, role: true, createdAt: true },
      });

      // Wallet kosong untuk admin baru, konsisten dengan pola seed.ts.
      await prisma.wallet.create({ data: { userId: newAdmin.id, balance: 0 } });

      await AuditLogger.log(
        req.user!.id,
        'ADMIN_CREATE_ADMIN',
        `Admin ${req.user!.id} membuat akun admin baru: ${normalizedEmail} (${newAdmin.id})`
      );

      return res.status(201).json({ admin: newAdmin });
    } catch (err: any) {
      const status = err instanceof AppError ? err.statusCode : 500;
      return res.status(status).json({ error: err.message || 'Gagal membuat akun admin.' });
    }
  }
);

// 🆕 AUDIT KEAMANAN: jalur SATU-SATUNYA yang sah bagi admin untuk menambah
// saldo user LAIN secara langsung tanpa lewat antrean TopupRequest (mis.
// kompensasi kesalahan sistem, refund manual di luar order). Menggantikan
// bypass lama di POST /api/wallet/topup (role ADMIN) yang menyasar wallet
// SENDIRI tanpa target eksplisit dan tanpa alasan tercatat -- itu celah
// self-dealing (admin manapun bisa mencetak saldo sendiri tanpa batas).
// Endpoint ini WAJIB target user lain (tidak bisa menyasar diri sendiri),
// WAJIB alasan (untuk audit), dan dibatasi Rp50 juta per transaksi.
router.post(
  '/wallet/credit',
  authenticateToken as any,
  authorizeRoles('ADMIN') as any,
  validateBody(adminWalletCreditSchema) as any,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const adminId = req.user!.id;
      const { targetUserId, amount, reason } = req.body;

      if (targetUserId === adminId) {
        throw new AppError('Admin tidak boleh menambah saldo wallet sendiri lewat endpoint ini!', 400);
      }

      const targetUser = await prisma.user.findUnique({ where: { id: targetUserId } });
      if (!targetUser) {
        throw new AppError('User tujuan tidak ditemukan!', 404);
      }

      const wallet = await prisma.wallet.upsert({
        where: { userId: targetUserId },
        create: { userId: targetUserId, balance: 0 },
        update: {},
      });

      const walletRepo = new WalletRepository();
      const result = await prisma.$transaction(async (tx) => {
        return walletRepo.applyDelta(
          tx,
          wallet.id,
          amount,
          'TOPUP',
          `Kredit manual oleh Admin: ${reason}`
        );
      });

      await AuditLogger.log(
        adminId,
        'ADMIN_WALLET_CREDIT',
        `Admin ${adminId} menambah saldo Rp${Number(amount).toLocaleString('id-ID')} ke wallet user ${targetUserId} (${targetUser.email}). Alasan: ${reason}`
      );

      return res.status(200).json({ wallet: result.wallet, transaction: result.transaction });
    } catch (err: any) {
      const status = err instanceof AppError ? err.statusCode : 500;
      return res.status(status).json({ error: err.message || 'Gagal menambah saldo wallet.' });
    }
  }
);

export const adminRouter = router;


