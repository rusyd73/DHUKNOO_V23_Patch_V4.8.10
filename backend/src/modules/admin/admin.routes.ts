import { Router, Response } from 'express';
import { authenticateToken, AuthenticatedRequest, authorizeRoles } from '../../core/middleware/auth.middleware';
import { prisma } from '../../config/prisma';
import { AuditLogger } from '../../core/logging/audit.logger';
import { validateBody } from '../../core/middleware/validation.middleware';
import { sensitiveAdminActionRateLimiter } from '../../core/middleware/rateLimit.middleware';
import { reviewDriverDocumentSchema, createAdminSchema, adminWalletCreditSchema } from '../../core/validation/schemas';
import { AuthService } from '../auth/auth.service';
import { WalletAdminController } from '../wallet/wallet.admin.controller';
import { ReconciliationController } from '../reconciliation/reconciliation.controller';
import { buildAdminRecap } from './admin-recap.service';
import { buildRecapExcel, buildRecapPdf } from './admin-export.service';

const authService = new AuthService();
const walletAdminControllerForAdminRoutes = new WalletAdminController();
const reconciliationController = new ReconciliationController();

const router = Router();

// ============================================================
// V4.8.7 ADMIN HIERARCHY — FAIL-SAFE
//
// SUPER ADMIN bukan role Prisma baru. Semua akun tetap ROLE=ADMIN.
// Pembeda hak akses ditentukan oleh identitas Super Admin.
//
// Prioritas:
// 1) SUPER_ADMIN_EMAIL bila di-set di .env dan akun tersebut masih aktif.
// 2) Jika ENV kosong/tidak cocok/tidak aktif, gunakan ADMIN AKTIF
//    PALING LAMA sebagai Super Admin agar instalasi lama V4.8.5
//    langsung bekerja tanpa konfigurasi tambahan.
//
// Dengan demikian patch tidak membutuhkan migration/schema baru dan
// tidak dapat membuat dashboard terkunci hanya karena ENV belum diisi.
// ============================================================
const normalizedEmail = (value?: string | null) => String(value || '').trim().toLowerCase();
const configuredSuperAdminEmail = () => normalizedEmail(process.env.SUPER_ADMIN_EMAIL);

const resolveSuperAdmin = async () => {
  const configuredEmail = configuredSuperAdminEmail();

  if (configuredEmail) {
    const configured = await prisma.user.findFirst({
      where: {
        role: 'ADMIN',
        isActive: true,
        email: { equals: configuredEmail, mode: 'insensitive' },
      },
      select: { id: true, email: true, fullName: true },
    });
    if (configured) return configured;
  }

  // Fallback V4.8.5 compatibility: ADMIN aktif tertua menjadi Super Admin.
  return prisma.user.findFirst({
    where: { role: 'ADMIN', isActive: true },
    select: { id: true, email: true, fullName: true },
    orderBy: { createdAt: 'asc' },
  });
};

const requireSuperAdmin = async (req: AuthenticatedRequest, res: Response, next: any) => {
  if (!req.user) return res.status(401).json({ error: 'Akses tidak sah.' });
  if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Hanya ADMIN yang dapat mengakses menu ini.' });

  try {
    const superAdmin = await resolveSuperAdmin();
    if (!superAdmin || superAdmin.id !== req.user.id) {
      return res.status(403).json({
        error: 'Akses ditolak. Hanya SUPER ADMIN yang dapat menambah atau menonaktifkan administrator lain.',
        code: 'SUPER_ADMIN_REQUIRED',
      });
    }
    next();
  } catch (err: any) {
    return res.status(503).json({
      error: 'Gagal memverifikasi otorisasi SUPER ADMIN.',
      code: 'SUPER_ADMIN_RESOLUTION_FAILED',
    });
  }
};

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
      const topupRequests = await prisma.topupRequest.findMany({
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
      });
      return res.status(200).json({ topupRequests });
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
        // 🆕 FIX: walletService.topup(userId, amount, callerRole) mewajibkan
        // callerRole === 'ADMIN' (guard anti direct-topup). Sebelumnya
        // dipanggil TANPA argumen ke-3 (undefined !== 'ADMIN'), jadi baris
        // ini SELALU throw 'Direct topup is not allowed' -- admin yang
        // approve topup lewat endpoint ini akan selalu dapat 500, dan
        // saldo user TIDAK bertambah meski status di-set APPROVED.
        // Konteksnya sah (ini memang alur approval admin resmi via
        // TopupRequest, sudah ada pengecekan status PENDING_REVIEW di
        // atas), jadi callerRole='ADMIN' diteruskan secara eksplisit.
        const WalletServiceModule = await import('../wallet/wallet.service');
        const walletService = new WalletServiceModule.WalletService();
        await walletService.topup(topupReq.userId, Number(topupReq.amount), 'ADMIN');
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

// CATATAN: route PATCH duplikat '/topup-requests/:id/review' yang dulu ada
// di sini DIHAPUS -- persis sama dengan route POST di atas, tidak dipakai
// frontend sama sekali (dicek di frontend/src/api/admin.api.ts, hanya
// panggil versi POST), dan sama-sama punya bug pemanggilan
// walletService.topup() tanpa callerRole. Dua implementasi identik untuk
// fitur yang sama adalah pola yang sudah terbukti berisiko di proyek ini
// (lihat commit sebelumnya soal Driver Eligibility yang tadinya
// terduplikasi 3x) -- disatukan jadi satu jalur saja.


// ── Verifikasi Dokumen Driver (KTP+selfie, STNK) ──────────────────────────
router.get(
  '/driver-documents/pending',
  authenticateToken as any,
  authorizeRoles('ADMIN') as any,
  async (_req: AuthenticatedRequest, res: Response) => {
    try {
      const documents = await prisma.driverDocument.findMany({
        where: { status: 'PENDING_REVIEW' },
        include: {
          driver: { include: { user: { select: { fullName: true, email: true } } } },
        },
        orderBy: { createdAt: 'asc' },
      });
      return res.status(200).json({ documents });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Gagal mengambil daftar dokumen.' });
    }
  }
);

router.get(
  '/driver-documents/:documentId/file',
  authenticateToken as any,
  authorizeRoles('ADMIN') as any,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { documentId } = req.params;
      const document = await prisma.driverDocument.findUnique({
        where: { id: documentId },
        select: { id: true, imageUrl: true },
      });

      if (!document) {
        return res.status(404).json({ error: 'Dokumen driver tidak ditemukan!' });
      }

      const rawUrl = String(document.imageUrl || '').trim();
      if (!rawUrl) {
        return res.status(404).json({ error: 'File dokumen tidak tersedia!' });
      }

      // Driver document uploads are stored under the backend /uploads directory.
      // Resolve ONLY the /uploads/<filename> path; never fetch arbitrary URLs.
      let pathname = rawUrl;
      try {
        pathname = new URL(rawUrl, 'http://dhuknoo.local').pathname;
      } catch {
        pathname = rawUrl;
      }

      const uploadsMarker = '/uploads/';
      const markerIndex = pathname.indexOf(uploadsMarker);
      if (markerIndex < 0) {
        return res.status(400).json({ error: 'Lokasi file dokumen tidak valid!' });
      }

      const filename = decodeURIComponent(pathname.slice(markerIndex + uploadsMarker.length));
      if (!filename || filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
        return res.status(400).json({ error: 'Nama file dokumen tidak valid!' });
      }

      const path = await import('path');
      const fs = await import('fs');
      const { UPLOAD_DIR_ABSOLUTE } = await import('../upload/upload.config');
      const absolutePath = path.join(UPLOAD_DIR_ABSOLUTE, filename);

      if (!fs.existsSync(absolutePath)) {
        return res.status(404).json({ error: 'File dokumen tidak ditemukan di server!' });
      }

      res.setHeader('Cache-Control', 'private, no-store');
      return res.sendFile(absolutePath);
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Gagal mengambil file dokumen.' });
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

      if (status === 'APPROVED') {
        await prisma.driverProfile.update({
          where: { id: document.driverId },
          data: { isVerified: true },
        });
      }

      await AuditLogger.log(adminId, 'DRIVER_DOCUMENT_REVIEWED', `Dokumen #${documentId} ditandai ${status}`);

      return res.status(200).json({ message: `Dokumen ditandai ${status}. Status akun driver telah diperbarui.`, document });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Gagal meninjau dokumen.' });
    }
  }
);

router.patch(
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

      if (status === 'APPROVED') {
        await prisma.driverProfile.update({
          where: { id: document.driverId },
          data: { isVerified: true },
        });
      }

      await AuditLogger.log(adminId, 'DRIVER_DOCUMENT_REVIEWED', `Dokumen #${documentId} ditandai ${status}`);

      return res.status(200).json({ message: `Dokumen ditandai ${status}. Status akun driver telah diperbarui.`, document });
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
      const timeframe = (req.query.timeframe as string) || 'daily'; // 'daily' | 'weekly' | 'monthly'
      // Satu sumber kebenaran untuk tampilan dan export. Implementasi lama di
      // bawah belum memuat withdrawal dan masih menghitung komisi tetap 8%.
      // Return ini memastikan endpoint memakai rekap berbasis ledger terbaru.
      return res.status(200).json(await buildAdminRecap(timeframe as any));

      /* istanbul ignore next -- legacy recap dipertahankan sementara untuk
         kompatibilitas patch, tetapi tidak lagi dieksekusi. */
      const now = new Date();
      let startDate = new Date();

      if (timeframe === 'weekly') {
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      } else if (timeframe === 'monthly') {
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      } else {
        // daily - 24 jam terakhir atau dari awal hari ini
        startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      }

      // 1. Pelanggan terdaftar lengkap identitas dan no HP
      const customers = await prisma.customerProfile.findMany({
        where: { createdAt: { gte: startDate } },
        include: {
          user: {
            select: {
              fullName: true,
              email: true,
              createdAt: true,
            },
          },
          orders: {
            select: { id: true, price: true, status: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      // Juga ambil semua pelanggan jika tidak ada yang daftar di rentang waktu tersebut
      const allCustomers = customers.length > 0 ? customers : await prisma.customerProfile.findMany({
        include: {
          user: {
            select: { fullName: true, email: true, createdAt: true },
          },
          orders: { select: { id: true, price: true, status: true } },
        },
        orderBy: { createdAt: 'desc' },
      });

      const formattedCustomers = allCustomers.map((c) => ({
        id: c.id,
        fullName: c.user.fullName,
        email: c.user.email,
        phoneNumber: c.phoneNumber || '081234567890',
        registeredAt: c.createdAt,
        totalOrders: c.orders.length,
        isAppInstalled: c.isAppInstalled,
      }));

      // 2. Mitra pengemudi identitas, no HP, sekaligus perolehannya
      const drivers = await prisma.driverProfile.findMany({
        include: {
          user: {
            select: { fullName: true, email: true, createdAt: true },
          },
          orders: {
            where: {
              status: 'COMPLETED',
              createdAt: { gte: startDate },
            },
            select: { id: true, price: true, discount: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      const formattedDrivers = drivers.map((d) => {
        const totalEarnings = d.orders.reduce((sum, o) => {
          const net = Number(o.price) - Number(o.discount || 0);
          const driverNet = Math.round(net * 0.92); // 92% bagian driver (8% komisi platform)
          return sum + driverNet;
        }, 0);

        return {
          id: d.id,
          fullName: d.user.fullName,
          email: d.user.email,
          phoneNumber: d.phoneNumber || '081987654321',
          vehiclePlate: d.vehiclePlate,
          vehicleModel: d.vehicleModel,
          isVerified: d.isVerified,
          isOnline: d.isOnline,
          completedOrdersCount: d.orders.length,
          perolehan: totalEarnings,
          registeredAt: d.createdAt,
        };
      });

      // 2b. Rekap merchant: total, status operasional, pemilik, dan lokasi.
      const merchants = await prisma.merchant.findMany({
        include: {
          owner: { select: { fullName: true, email: true, isActive: true } },
          _count: { select: { products: true, orders: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
      const formattedMerchants = merchants.map((m) => ({
        id: m.id, name: m.name, ownerName: m.owner?.fullName || 'Belum terhubung',
        ownerEmail: m.owner?.email || '-', category: m.category, address: m.address,
        latitude: m.latitude, longitude: m.longitude, phone: m.phone || '-', isOpen: m.isOpen,
        ownerIsActive: m.owner?.isActive ?? false,
        status: !m.owner ? 'NO_OWNER' : !m.owner.isActive ? 'OWNER_INACTIVE' : m.isOpen ? 'ACTIVE' : 'INACTIVE',
        registeredAt: m.createdAt, productCount: m._count.products, orderCount: m._count.orders,
      }));
      const merchantSummary = {
        total: formattedMerchants.length,
        active: formattedMerchants.filter((m) => m.status === 'ACTIVE').length,
        inactive: formattedMerchants.filter((m) => m.status === 'INACTIVE').length,
        ownerInactive: formattedMerchants.filter((m) => m.status === 'OWNER_INACTIVE').length,
        noOwner: formattedMerchants.filter((m) => m.status === 'NO_OWNER').length,
        registeredInTimeframe: formattedMerchants.filter((m) => new Date(m.registeredAt) >= startDate).length,
      };

      // 3. Volume transaksi dari mana kemana oleh siapa
      const orders = await prisma.order.findMany({
        where: { createdAt: { gte: startDate } },
        include: {
          customer: {
            include: { user: { select: { fullName: true, email: true } } },
          },
          driver: {
            include: { user: { select: { fullName: true, email: true } } },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      // Jika tidak ada order di rentang waktu spesifik, ambil order terbaru agar tabel tidak kosong
      const activeOrdersList = orders.length > 0 ? orders : await prisma.order.findMany({
        take: 50,
        include: {
          customer: { include: { user: { select: { fullName: true, email: true } } } },
          driver: { include: { user: { select: { fullName: true, email: true } } } },
        },
        orderBy: { createdAt: 'desc' },
      });

      const formattedTransactions = activeOrdersList.map((o) => ({
        id: o.id,
        serviceType: o.serviceType,
        pickupAddress: o.pickupAddress,
        dropoffAddress: o.dropoffAddress,
        customerName: o.customer?.user?.fullName || 'Pelanggan OBAMA',
        customerPhone: o.customer?.phoneNumber || '081234567890',
        driverName: o.driver?.user?.fullName || 'Mitra Pengemudi',
        driverPhone: o.driver?.phoneNumber || '081987654321',
        driverPlate: o.driver?.vehiclePlate || 'N/A',
        price: Number(o.price),
        discount: Number(o.discount || 0),
        status: o.status,
        createdAt: o.createdAt,
      }));

      // 4. Platform revenue dari mana kemana oleh siapa
      const completedOrdersForRevenue = activeOrdersList.filter((o) => o.status === 'COMPLETED');
      const formattedRevenues = (completedOrdersForRevenue.length > 0 ? completedOrdersForRevenue : activeOrdersList).map((o) => {
        const grossPrice = Number(o.price);
        const discount = Number(o.discount || 0);
        const netPrice = Math.max(0, grossPrice - discount);
        const platformRevenue = Math.round(netPrice * 0.08); // 8% komisi platform OBAMA

        return {
          id: o.id,
          serviceType: o.serviceType,
          pickupAddress: o.pickupAddress,
          dropoffAddress: o.dropoffAddress,
          customerName: o.customer?.user?.fullName || 'Pelanggan OBAMA',
          driverName: o.driver?.user?.fullName || 'Mitra Pengemudi',
          distanceKm: Number(o.distanceKm || 0),
          grossPrice,
          discount,
          netPrice,
          platformRevenue,
          createdAt: o.createdAt,
        };
      });

      const totalPlatformRevenue = formattedRevenues.reduce((acc, curr) => acc + curr.platformRevenue, 0);
      const totalVolumeValue = formattedTransactions.reduce((acc, curr) => acc + curr.price, 0);

      return res.status(200).json({
        timeframe,
        summary: {
          totalCustomersCount: formattedCustomers.length,
          totalDriversCount: formattedDrivers.length,
          totalTransactionsCount: formattedTransactions.length,
          totalVolumeValue,
          totalPlatformRevenue,
          totalMerchantsCount: merchantSummary.total,
          activeMerchantsCount: merchantSummary.active,
          inactiveMerchantsCount: merchantSummary.inactive,
          ownerInactiveMerchantsCount: merchantSummary.ownerInactive,
          merchantsRegisteredInTimeframe: merchantSummary.registeredInTimeframe,
        },
        customers: formattedCustomers,
        drivers: formattedDrivers,
        merchants: formattedMerchants,
        merchantSummary,
        transactions: formattedTransactions,
        platformRevenues: formattedRevenues,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Gagal mengambil rekapitulasi data platform.' });
    }
  }
);


// ── Export Rekapitulasi Laporan (Excel / PDF) ─────────────────────────────
// Endpoint ini sengaja memakai sumber data yang sama dengan GET /recap agar
// tampilan dashboard dan file unduhan tidak menghasilkan angka yang berbeda.
const normalizeRecapTimeframe = (value: unknown): 'daily' | 'weekly' | 'monthly' => {
  const timeframe = String(value || 'daily');
  if (!['daily', 'weekly', 'monthly'].includes(timeframe)) return 'daily';
  return timeframe as 'daily' | 'weekly' | 'monthly';
};

router.get(
  '/export/excel',
  authenticateToken as any,
  authorizeRoles('ADMIN') as any,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const timeframe = normalizeRecapTimeframe(req.query.timeframe);
      const recap = await buildAdminRecap(timeframe);
      const file = await buildRecapExcel(recap);
      const filename = `dhuknoo-rekap-${timeframe}-${new Date().toISOString().slice(0, 10)}.xlsx`;

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Cache-Control', 'private, no-store');
      return res.status(200).send(file);
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Gagal membuat file Excel.' });
    }
  }
);

router.get(
  '/export/pdf',
  authenticateToken as any,
  authorizeRoles('ADMIN') as any,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const timeframe = normalizeRecapTimeframe(req.query.timeframe);
      const recap = await buildAdminRecap(timeframe);
      const file = await buildRecapPdf(recap);
      const filename = `dhuknoo-rekap-${timeframe}-${new Date().toISOString().slice(0, 10)}.pdf`;

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Cache-Control', 'private, no-store');
      return res.status(200).send(file);
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Gagal membuat file PDF.' });
    }
  }
);


// ============================================================
// 👥 GET /api/admin/admins
// Semua ADMIN boleh melihat daftar administrator.
// Hak mutasi tetap dikunci oleh requireSuperAdmin di backend.
// ============================================================
router.get(
  '/admins',
  authenticateToken as any,
  authorizeRoles('ADMIN') as any,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const [admins, superAdmin] = await Promise.all([
        prisma.user.findMany({
          where: { role: 'ADMIN' },
          select: {
            id: true,
            email: true,
            fullName: true,
            role: true,
            isActive: true,
            createdAt: true,
            updatedAt: true,
            deactivatedAt: true,
            deactivatedBy: true,
            deactivationReason: true,
          },
          orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }],
        }),
        resolveSuperAdmin(),
      ]);

      return res.status(200).json({
        success: true,
        isSuperAdmin: Boolean(superAdmin && superAdmin.id === req.user?.id),
        superAdminConfigured: Boolean(configuredSuperAdminEmail()),
        superAdminId: superAdmin?.id || null,
        admins: admins.map((admin) => ({
          ...admin,
          isSuperAdmin: Boolean(superAdmin && admin.id === superAdmin.id),
        })),
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Gagal memuat daftar administrator.' });
    }
  }
);

// ============================================================
// 🔒 POST /api/admin/create-admin
// Satu-satunya jalur lain (selain seed database) untuk membuat akun
// ADMIN baru. HANYA bisa dipanggil oleh admin yang sudah login.
// ============================================================
router.post(
  '/create-admin',
  authenticateToken as any,
  authorizeRoles('ADMIN') as any,
  requireSuperAdmin,
  sensitiveAdminActionRateLimiter,
  validateBody(createAdminSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const creatorId = req.user!.id;
      const { email, password, fullName, phone } = req.body;

      const newAdmin = await authService.createAdmin({
        email,
        passwordPlain: password,
        fullName,
        phone,
      });

      await AuditLogger.log(
        creatorId,
        'ADMIN_CREATED',
        `SUPER ADMIN membuat akun ADMIN BIASA: ${newAdmin.id} (${newAdmin.email})`
      );

      return res.status(201).json({
        success: true,
        message: 'Akun ADMIN BIASA berhasil dibuat.',
        data: newAdmin,
      });
    } catch (err: any) {
      const status = err?.statusCode || 500;
      return res.status(status).json({
        success: false,
        error: err.message || 'Gagal membuat akun admin baru.',
      });
    }
  }
);

// ============================================================
// 🔐 PATCH /api/admin/admins/:adminId/deactivate
// Soft-disable. Histori tetap tersimpan.
// SUPER ADMIN tidak dapat menonaktifkan dirinya sendiri maupun
// akun yang sedang menjadi SUPER ADMIN.
// ============================================================
router.patch(
  '/admins/:adminId/deactivate',
  authenticateToken as any,
  authorizeRoles('ADMIN') as any,
  requireSuperAdmin,
  sensitiveAdminActionRateLimiter,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const creatorId = req.user!.id;
      const { adminId } = req.params;
      const reason = String(req.body?.reason || 'Administrator tidak lagi aktif').trim().slice(0, 255);

      if (adminId === creatorId) {
        return res.status(400).json({ error: 'SUPER ADMIN tidak dapat menonaktifkan akunnya sendiri.' });
      }

      const superAdmin = await resolveSuperAdmin();
      if (superAdmin?.id === adminId) {
        return res.status(400).json({ error: 'SUPER ADMIN tidak dapat dinonaktifkan melalui menu ini.' });
      }

      const target = await prisma.user.findUnique({
        where: { id: adminId },
        select: { id: true, email: true, fullName: true, role: true, isActive: true },
      });

      if (!target || target.role !== 'ADMIN') {
        return res.status(404).json({ error: 'Administrator tidak ditemukan.' });
      }

      if (!target.isActive) {
        return res.status(400).json({ error: 'Administrator tersebut sudah nonaktif.' });
      }

      const updated = await prisma.user.update({
        where: { id: adminId },
        data: {
          isActive: false,
          deactivatedAt: new Date(),
          deactivatedBy: creatorId,
          deactivationReason: reason,
        },
        select: {
          id: true,
          email: true,
          fullName: true,
          role: true,
          isActive: true,
          deactivatedAt: true,
          deactivatedBy: true,
          deactivationReason: true,
        },
      });

      await AuditLogger.log(
        creatorId,
        'ADMIN_DEACTIVATED',
        `SUPER ADMIN menonaktifkan ADMIN BIASA: ${target.fullName} (${target.email}). Alasan: ${reason}`
      );

      return res.status(200).json({
        success: true,
        message: `Akses admin ${target.fullName} berhasil dinonaktifkan.`,
        data: updated,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Gagal menonaktifkan administrator.' });
    }
  }
);

// ============================================================
// 🔒 POST /api/admin/wallet/credit
// Satu-satunya jalur sah admin mengkredit saldo user LAIN secara
// langsung, di luar antrean TopupRequest. Menggantikan bypass lama
// 'role===ADMIN' di POST /api/wallet/topup yang mengkredit wallet
// PEMANGGIL SENDIRI tanpa target eksplisit, tanpa alasan, dan tanpa
// batas nominal yang ditegakkan di endpoint itu sendiri.
// ============================================================
router.post(
  '/wallet/credit',
  authenticateToken as any,
  authorizeRoles('ADMIN') as any,
  sensitiveAdminActionRateLimiter,
  validateBody(adminWalletCreditSchema),
  walletAdminControllerForAdminRoutes.credit as any
);

// ============================================================
// 🔒 GET /api/admin/reconciliation/pending
// POST /api/admin/reconciliation/:orderId/retry
// 🆕 FIX P1 "Reconciliation/retry workflow" (audit a1.4) -- lihat
// komentar lengkap di reconciliation.service.ts. Daftar order yang
// settlement-nya masih menggantung (RETRY_REQUIRED/FAILED), dan
// endpoint untuk memicu retry-nya secara terkendali oleh admin.
// ============================================================
router.get(
  '/reconciliation/pending',
  authenticateToken as any,
  authorizeRoles('ADMIN') as any,
  reconciliationController.listPending as any
);
router.post(
  '/reconciliation/:orderId/retry',
  authenticateToken as any,
  authorizeRoles('ADMIN') as any,
  sensitiveAdminActionRateLimiter,
  reconciliationController.retry as any
);

export const adminRouter = router;
