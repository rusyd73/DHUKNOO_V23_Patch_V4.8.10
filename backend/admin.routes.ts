import { Router, Response } from 'express';
import { authenticateToken, AuthenticatedRequest, authorizeRoles } from '../../core/middleware/auth.middleware';
import { prisma } from '../../config/prisma';
import { AuditLogger } from '../../core/logging/audit.logger';
import { validateBody } from '../../core/middleware/validation.middleware';
import { reviewDriverDocumentSchema } from '../../core/validation/schemas';

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

router.patch(
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
        customerName: o.customer?.user?.fullName || 'Pelanggan DHUKNOO',
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
        const platformRevenue = Math.round(netPrice * 0.08); // 8% komisi platform DHUKNOO

        return {
          id: o.id,
          serviceType: o.serviceType,
          pickupAddress: o.pickupAddress,
          dropoffAddress: o.dropoffAddress,
          customerName: o.customer?.user?.fullName || 'Pelanggan DHUKNOO',
          driverName: o.driver?.user?.fullName || 'Mitra Pengemudi',
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
        },
        customers: formattedCustomers,
        drivers: formattedDrivers,
        transactions: formattedTransactions,
        platformRevenues: formattedRevenues,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Gagal mengambil rekapitulasi data platform.' });
    }
  }
);


export const adminRouter = router;


