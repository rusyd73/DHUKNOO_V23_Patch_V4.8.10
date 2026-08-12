import { Router, Response } from "express";
import {
  authenticateToken,
  AuthenticatedRequest,
  authorizeRoles,
} from "../../../core/middleware/auth.middleware";
import { validateBody } from "../../../core/middleware/validation.middleware";
import { prisma } from "../../../config/prisma";
import { AuditLogger } from "../../../core/logging/audit.logger";
import { SocketService } from "../../../websocket/socket";
import { updateOrderStatusSchema } from "../../../core/validation/schemas";
import { OrderStatus } from "@prisma/client";
import { TariffEngineService } from "../../tariff/tariff.service";
import { PaymentService } from "../../payment/payment.service";
import { DriverEligibilityService } from "../services/driver-eligibility.service";
import { JobService } from "../services/job.service";  // <-- TAMBAHKAN

const router = Router();
const paymentService = new PaymentService();
const tariffEngine = new TariffEngineService();
const eligibilityService = new DriverEligibilityService();
const jobService = new JobService();  // <-- TAMBAHKAN

export { router as jobRouter };

const allowedTransitions: Record<OrderStatus, OrderStatus[]> = {
  PENDING: [OrderStatus.ACCEPTED, OrderStatus.CANCELLED],
  ACCEPTED: [OrderStatus.ON_THE_WAY, OrderStatus.CANCELLED],
  ON_THE_WAY: [OrderStatus.ARRIVED, OrderStatus.CANCELLED],
  ARRIVED: [OrderStatus.COMPLETED],
  COMPLETED: [],
  CANCELLED: [],
};

const ACTIVE_STATUSES: OrderStatus[] = [
  OrderStatus.ACCEPTED,
  OrderStatus.ON_THE_WAY,
  OrderStatus.ARRIVED,
];

// ============================================================
// 🔒 GET /api/driver/jobs - HANYA ORDER YANG ELIGIBLE
// ============================================================
router.get(
  '/jobs',
  authenticateToken as any,
  authorizeRoles('DRIVER') as any,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: 'Tidak terautentikasi' });
      }

      const { limit = 20, offset = 0 } = req.query;

      const result = await jobService.getEligibleJobs(
        userId,
        Number(limit),
        Number(offset)
      );

      return res.status(200).json({
        success: true,
        data: result.jobs,
        pagination: {
          total: result.total,
          limit: Number(limit),
          offset: Number(offset),
        },
        metadata: {
          serviceType: result.serviceType,
          minimumDeposit: result.minimumDeposit,
          balance: result.balance,
        },
      });
    } catch (err: any) {
      console.error('[GET /jobs] Error:', err);
      const status = err.message?.includes('not found') ? 404 :
                     err.message?.includes('not active') ? 403 :
                     err.message?.includes('offline') ? 403 :
                     err.message?.includes('tidak mencukupi') ? 403 : 500;
      return res.status(status).json({ error: err.message || 'Internal Server Error' });
    }
  }
);

// ============================================================
// 🔒 POST /api/driver/jobs/:orderId/accept
// ============================================================
router.post(
  "/jobs/:orderId/accept",
  authenticateToken as any,
  authorizeRoles("DRIVER") as any,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user?.id;
      const { orderId } = req.params;

      if (!userId) {
        return res.status(401).json({ error: "Tidak terautentikasi" });
      }

      const driverProfile = await prisma.driverProfile.findUnique({
        where: { userId },
        include: { user: true },
      });

      if (!driverProfile) {
        return res.status(404).json({ error: "Profil driver tidak ditemukan!" });
      }

      if (!driverProfile.isVerified) {
        return res.status(403).json({ error: "Akun driver belum diverifikasi!" });
      }

      // ============================================================
      // 🔒 CEK ORDER
      // ============================================================
      const orderToClaim = await prisma.order.findUnique({
        where: { id: orderId },
        select: { serviceType: true, status: true, pickupLat: true, pickupLng: true },
      });

      if (!orderToClaim) {
        return res.status(404).json({ error: "Order tidak ditemukan!" });
      }

      if (orderToClaim.status !== OrderStatus.PENDING) {
        return res.status(409).json({ error: "Order sudah tidak tersedia!" });
      }

      // ============================================================
      // 🔒 CEK ELIGIBILITY (SATU FUNGSI)
      // ============================================================
      const minimumDeposit = await tariffEngine.getMinimumDriverDeposit();

      const eligibility = await eligibilityService.check({
        driverId: driverProfile.id,
        order: {
          serviceType: orderToClaim.serviceType,
          pickupLat: orderToClaim.pickupLat || 0,
          pickupLng: orderToClaim.pickupLng || 0,
        },
        options: {
          minimumDeposit,
          maxDistanceKm: 5,
          maxDailyOrders: 20,
          checkLocationFreshness: false,
        },
      });

      if (!eligibility.isEligible) {
        return res.status(403).json({
          error: `Driver tidak eligible: ${eligibility.reasons.join(', ')}`,
        });
      }

      // ============================================================
      // 🔒 CEK KLASIFIKASI (SEND dan MART dikecualikan)
      // ============================================================
      const isSendOrMart = orderToClaim.serviceType === 'SEND' || orderToClaim.serviceType === 'MART';
      if (!isSendOrMart && orderToClaim.serviceType !== (driverProfile as any).serviceType) {
        return res.status(403).json({
          error: `Order ini untuk layanan ${orderToClaim.serviceType}, sedangkan akun Anda terdaftar sebagai driver ${(driverProfile as any).serviceType}.`,
        });
      }

      // ============================================================
      // 🔒 CEK ORDER AKTIF
      // ============================================================
      const activeOrder = await prisma.order.findFirst({
        where: { driverId: driverProfile.id, status: { in: ACTIVE_STATUSES } },
      });

      if (activeOrder) {
        return res.status(409).json({
          error: "Selesaikan order yang sedang berjalan sebelum menerima order baru.",
        });
      }

      // ============================================================
      // 🔒 CEK UNCONFIRMED CASH
      // ============================================================
      const unconfirmedCash = await prisma.order.findFirst({
        where: {
          driverId: driverProfile.id,
          status: "COMPLETED",
          paymentMethod: "CASH",
          isPaid: false,
        },
        select: { id: true },
      });

      if (unconfirmedCash) {
        return res.status(403).json({
          error: `Anda masih punya pembayaran CASH order #${unconfirmedCash.id} yang belum dikonfirmasi.`,
        });
      }

      // ============================================================
      // 🔒 ATOMIC ACCEPT
      // ============================================================
      const updatedOrder = await prisma.$transaction(async (tx) => {
        const result = await tx.order.updateMany({
          where: { id: orderId, status: OrderStatus.PENDING },
          data: {
            status: OrderStatus.ACCEPTED,
            driverId: driverProfile.id,
            acceptedAt: new Date(),
          },
        });

        if (result.count === 0) {
          throw new Error("ORDER_ALREADY_ACCEPTED");
        }

        const orderAfterUpdate = await tx.order.findUnique({
          where: { id: orderId },
          include: {
            customer: { include: { user: { select: { fullName: true, email: true } } } },
            driver: { include: { user: { select: { fullName: true } } } },
          },
        });

        if (!orderAfterUpdate) {
          throw new Error("ORDER_NOT_FOUND");
        }

        await AuditLogger.log(userId, "DRIVER_ACCEPT_ORDER", `Mengambil order #${orderId}`, tx);

        return orderAfterUpdate;
      });

      // ============================================================
      // 🔒 REALTIME NOTIFICATIONS
      // ============================================================
      try {
        SocketService.emitToOrder(updatedOrder.id, "order_status_changed", {
          orderId: updatedOrder.id,
          status: updatedOrder.status,
          driverId: driverProfile.id,
        });
        SocketService.emitToUser(updatedOrder.customer.userId, "order_accepted", {
          orderId: updatedOrder.id,
          driverId: driverProfile.id,
          driver: {
            fullName: (updatedOrder as any).driver?.user?.fullName,
            vehicleModel: (updatedOrder as any).driver?.vehicleModel,
            vehiclePlate: (updatedOrder as any).driver?.vehiclePlate,
          },
        });
        SocketService.emitToDriversPool("order_taken", { orderId: updatedOrder.id });
        SocketService.emitToAdmins("order_accepted", { orderId: updatedOrder.id });
      } catch {
        // Socket.IO belum siap
      }

      return res.status(200).json({
        success: true,
        message: "Order berhasil diterima! Silakan jemput pelanggan.",
        order: updatedOrder,
      });

    } catch (err: any) {
      console.error('[POST /jobs/:orderId/accept] Error:', err);
      if (err.message === "ORDER_ALREADY_ACCEPTED") {
        return res.status(409).json({ error: "Order sudah diterima driver lain." });
      }
      if (err.message === "ORDER_NOT_FOUND") {
        return res.status(404).json({ error: "Order tidak ditemukan." });
      }
      return res.status(500).json({ error: "Internal Server Error" });
    }
  }
);

// ============================================================
// 🔒 POST /api/driver/jobs/:orderId/status
// ============================================================
router.post(
  "/jobs/:orderId/status",
  authenticateToken as any,
  authorizeRoles("DRIVER") as any,
  validateBody(updateOrderStatusSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user?.id;
      const { orderId } = req.params;
      const { status } = req.body;

      if (!userId) {
        return res.status(401).json({ error: "Tidak terautentikasi" });
      }

      const driverProfile = await prisma.driverProfile.findUnique({
        where: { userId },
      });

      if (!driverProfile) {
        return res.status(404).json({ error: "Profil driver tidak ditemukan!" });
      }

      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { customer: true },
      });

      if (!order) {
        return res.status(404).json({ error: "Order tidak ditemukan!" });
      }

      if (order.driverId !== driverProfile.id) {
        return res.status(403).json({ error: "Anda tidak berwenang mengelola order ini!" });
      }

      if (order.status === OrderStatus.COMPLETED || order.status === OrderStatus.CANCELLED) {
        return res.status(409).json({
          error: "Order sudah berada pada status final dan tidak dapat diubah lagi.",
        });
      }

      const allowed = allowedTransitions[order.status] ?? [];
      if (!allowed.includes(status)) {
        return res.status(400).json({
          error: `Status ${order.status} tidak boleh diubah menjadi ${status}.`,
        });
      }

      const updatedOrder = await prisma.$transaction(async (tx) => {
        const result = await tx.order.updateMany({
          where: { id: orderId, status: order.status },
          data: { status },
        });

        if (result.count === 0) {
          throw new Error("ORDER_STATUS_CHANGED");
        }

        const orderAfterUpdate = await tx.order.findUnique({
          where: { id: orderId },
        });

        if (!orderAfterUpdate) {
          throw new Error("ORDER_NOT_FOUND");
        }

        await AuditLogger.log(
          userId,
          "DRIVER_UPDATE_ORDER_STATUS",
          `Mengubah status order #${orderId} menjadi ${status}`,
          tx
        );

        return orderAfterUpdate;
      });

      // Realtime notifications
      try {
        const recipients = [order.customer.userId, userId];
        SocketService.emitToOrder(orderId, "order_status_changed", {
          orderId: updatedOrder.id,
          status: updatedOrder.status,
        });
        recipients.forEach((uid) =>
          SocketService.emitToUser(uid, "order_status_changed", {
            orderId: updatedOrder.id,
            status: updatedOrder.status,
          })
        );
        if (status === OrderStatus.COMPLETED) {
          SocketService.emitToOrder(orderId, "order_completed", { orderId });
          recipients.forEach((uid) => SocketService.emitToUser(uid, "order_completed", { orderId }));
        }
        if (status === OrderStatus.CANCELLED) {
          SocketService.emitToOrder(orderId, "order_cancelled", { orderId });
          recipients.forEach((uid) => SocketService.emitToUser(uid, "order_cancelled", { orderId }));
        }
        SocketService.emitToAdmins("order_status_changed", { orderId, status });
      } catch {
        // Socket.IO belum siap
      }

      // Auto-debit untuk WALLET
      let autoDebitFailed = false;
      let finalOrder = updatedOrder;
      if (status === OrderStatus.COMPLETED && updatedOrder.paymentMethod === 'WALLET' && !updatedOrder.isPaid) {
        try {
          await paymentService.chargeOrder(order.customer.userId, orderId, `auto-wallet-${orderId}`);
          const refreshed = await prisma.order.findUnique({ where: { id: orderId } });
          if (refreshed) finalOrder = refreshed;
        } catch (err: any) {
          autoDebitFailed = true;
          try {
            SocketService.emitToUser(order.customer.userId, 'auto_debit_failed', {
              orderId,
              error: err?.message || 'Auto debet saldo wallet gagal. Silakan cek saldo Anda.',
            });
          } catch {
            // Socket.IO belum siap
          }
        }
      }

      const note =
        status === OrderStatus.COMPLETED
          ? autoDebitFailed
            ? " Auto-debet saldo wallet GAGAL (saldo kurang) — minta customer top-up & bayar manual."
            : updatedOrder.paymentMethod === 'WALLET'
              ? " Saldo wallet customer sudah otomatis terpotong (auto debet)."
              : " Minta customer menyelesaikan pembayaran melalui endpoint payment."
          : "";

      return res.status(200).json({
        success: true,
        message: `Status order berhasil diperbarui ke ${status}!${note}`,
        order: finalOrder,
      });
    } catch (err: any) {
      console.error('[POST /jobs/:orderId/status] Error:', err);
      if (err.message === "ORDER_STATUS_CHANGED") {
        return res.status(409).json({
          error: "Status order telah berubah oleh proses lain. Silakan refresh data.",
        });
      }
      if (err.message === "ORDER_NOT_FOUND") {
        return res.status(404).json({ error: "Order tidak ditemukan." });
      }
      return res.status(500).json({ error: "Internal Server Error" });
    }
  }
);