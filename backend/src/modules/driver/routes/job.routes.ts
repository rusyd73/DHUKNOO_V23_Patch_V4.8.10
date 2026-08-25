import { Router, Response } from "express";
import {
  authenticateToken,
  AuthenticatedRequest,
  authorizeRoles,
} from "../../../core/middleware/auth.middleware";
import { validateBody } from "../../../core/middleware/validation.middleware";
import { prisma } from "../../../config/prisma";
import { AuditLogger } from "../../../core/logging/audit.logger";
import { AppError } from "../../../core/errors/AppError";
import { SocketService } from "../../../websocket/socket";
import { updateOrderStatusSchema } from "../../../core/validation/schemas";
import { OrderStatus } from "@prisma/client";
import { TariffEngineService } from "../../tariff/tariff.service";
import { PaymentService } from "../../payment/payment.service";
import { DriverEligibilityService } from "../services/driver-eligibility.service";
import { JobService } from "../services/job.service";
import { DriverPickupCompensationService } from "../services/driver-pickup-compensation.service";
import { getOrderNumber } from "../../../core/utils/order-number";  // <-- TAMBAHKAN

const router = Router();
const paymentService = new PaymentService();
const tariffEngine = new TariffEngineService();
const eligibilityService = new DriverEligibilityService();
const jobService = new JobService();  // <-- TAMBAHKAN
const pickupCompensationService = new DriverPickupCompensationService();

export { router as jobRouter };

const allowedTransitions: Record<OrderStatus, OrderStatus[]> = {
  PENDING: [],
  ACCEPTED: [OrderStatus.ON_THE_WAY, OrderStatus.CANCELLED],
  ON_THE_WAY: [OrderStatus.ARRIVED, OrderStatus.CANCELLED],
  ARRIVED: [OrderStatus.PICKED_UP, OrderStatus.CANCELLED],
  PICKED_UP: [OrderStatus.ARRIVED_CUSTOMER, OrderStatus.CANCELLED],
  ARRIVED_CUSTOMER: [OrderStatus.COMPLETED, OrderStatus.CANCELLED],
  COMPLETED: [],
  CANCELLED: [],
};

const ACTIVE_STATUSES: OrderStatus[] = [
  OrderStatus.ACCEPTED,
  OrderStatus.ON_THE_WAY,
  OrderStatus.ARRIVED,
  OrderStatus.PICKED_UP,
  OrderStatus.ARRIVED_CUSTOMER,
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

      // V4: response contract dibuat eksplisit agar dashboard driver tidak
      // perlu menebak apakah active trip berada di data.jobs atau field lain.
      // Normalisasi dilakukan rekursif untuk BigInt/Decimal tanpa JSON.parse
      // + JSON.stringify yang dapat merusak tipe/menimbulkan error lanjutan.
      const jsonSafe = (value: any): any => {
        if (typeof value === 'bigint') return Number(value);
        if (value && typeof value === 'object') {
          if (typeof value.toNumber === 'function') return value.toNumber();
          if (Array.isArray(value)) return value.map(jsonSafe);
          return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonSafe(item)]));
        }
        return value;
      };

      return res.status(200).json(jsonSafe({
        success: true,
        data: result.jobs,
        jobs: result.jobs,
        activeJobs: result.activeJobs,
        activeJob: result.activeJobs[0] ?? null,
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
      }));
    } catch (err: any) {
      // 🆕 FIX P0 "correlation/request ID dan logging terstruktur"
      // (audit driver-jobs): route ini menangani errornya sendiri
      // (tidak lewat next(err)/errorHandler global), jadi requestId
      // disertakan manual di sini juga -- lihat requestId.middleware.ts.
      (req.log || console).error({ err, requestId: req.requestId }, '[GET /jobs] Error:');
      const status = err instanceof AppError ? err.statusCode : 500;
      const code = err instanceof AppError ? err.code : undefined;
      return res.status(status).json({ error: err.message || 'Internal Server Error', code, requestId: req.requestId });
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
        select: { serviceType: true, status: true, pickupLat: true, pickupLng: true, vehicleRequirement: true },
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
          vehicleRequirement: orderToClaim.vehicleRequirement,
        },
        options: {
          minimumDeposit,
          maxDistanceKm: 3, // MONETIZATION_V1: extended radius 3km
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

      // FIX7: hitung snapshot DRIVER -> PICKUP sebelum transaksi claim.
      // Snapshot memakai lokasi driver saat ACCEPT dan tidak mengubah tarif customer.
      const pickupCompensation = await pickupCompensationService.calculate({
        serviceType: orderToClaim.serviceType,
        driverLat: driverProfile.latitude,
        driverLng: driverProfile.longitude,
        pickupLat: orderToClaim.pickupLat,
        pickupLng: orderToClaim.pickupLng,
      });

      // ============================================================
      // 🔒 ATOMIC ACCEPT + PICKUP COMPENSATION SNAPSHOT
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
            // 🆕 FIX: sebelumnya `merchant` tidak di-include di sini, jadi
            // di bawah kita tidak pernah tahu siapa `ownerId` toko untuk
            // order ini -- akibatnya notifikasi "order diterima driver"
            // TIDAK PERNAH sampai ke merchant sama sekali (lihat komentar
            // panjang di REALTIME NOTIFICATIONS di bawah). Ini P0 root
            // cause kenapa bel ring di dashboard Merchant looping terus
            // walau order sudah di-accept -- baru berhenti kalau merchant
            // manual refresh halaman.
            merchant: { select: { ownerId: true } },
            stops: { orderBy: { sequence: 'asc' } },
          },
        });

        if (!orderAfterUpdate) {
          throw new Error("ORDER_NOT_FOUND");
        }

        const pricing = await tx.pricingHistory.findUnique({ where: { orderId } });
        const currentBreakdown = pricing?.breakdown && typeof pricing.breakdown === 'object'
          ? (pricing.breakdown as Record<string, unknown>)
          : {};
        await tx.pricingHistory.upsert({
          where: { orderId },
          create: { orderId, tariffVersionId: null, breakdown: pickupCompensation as any },
          update: { breakdown: { ...currentBreakdown, ...pickupCompensation } as any },
        });

        await AuditLogger.log(
          userId,
          "DRIVER_ACCEPT_ORDER",
          `Mengambil order #${orderId}; pickup ${pickupCompensation.driverPickupDistanceKm}km; kompensasi Rp${pickupCompensation.driverPickupCompensation}`,
          tx
        );

        return orderAfterUpdate;
      });

      // ============================================================
      // 🔒 REALTIME NOTIFICATIONS
      // ============================================================
      try {
        SocketService.emitToOrder(updatedOrder.id, "order_status_changed", {
          orderId: updatedOrder.id,
          orderNumber: getOrderNumber(updatedOrder.id),
          status: updatedOrder.status,
          driverId: driverProfile.id,
        });
        // 🆕 FIX P0 "Ring loop merchant tidak pernah berhenti": event
        // `order_status_changed` di atas dikirim lewat `emitToOrder` (room
        // `order_<id>`) yang TIDAK PERNAH di-join oleh dashboard Merchant
        // (merchant hanya mendengarkan lewat user-targeted emit, lihat
        // MerchantApp.tsx). Sebelumnya tidak ada emit langsung ke
        // `merchant.ownerId` sama sekali di titik "order diterima driver"
        // ini, jadi `handleOrderStatusUpdate` di sisi Merchant tidak pernah
        // terpanggil -> `stopRingLoop()` tidak pernah jalan -> bel bunyi
        // terus sampai merchant manual refresh halaman. Order tanpa
        // merchant (BIKE/CAR/SEND) otomatis dilewati (optional chaining).
        if (updatedOrder.merchant?.ownerId) {
          SocketService.emitToUser(updatedOrder.merchant.ownerId, "order_status_changed", {
            orderId: updatedOrder.id,
            orderNumber: getOrderNumber(updatedOrder.id),
            status: updatedOrder.status,
            driverId: driverProfile.id,
          });
        }
        SocketService.emitToUser(updatedOrder.customer.userId, "order_accepted", {
          orderId: updatedOrder.id,
          orderNumber: getOrderNumber(updatedOrder.id),
          driverId: driverProfile.id,
          driver: {
            fullName: (updatedOrder as any).driver?.user?.fullName,
            vehicleModel: (updatedOrder as any).driver?.vehicleModel,
            vehiclePlate: (updatedOrder as any).driver?.vehiclePlate,
          },
        });
        if (updatedOrder.serviceType === 'MART') {
          SocketService.emitToUser(updatedOrder.customer.userId, "mart_driver_heading_to_merchant", {
            orderId: updatedOrder.id,
            orderNumber: getOrderNumber(updatedOrder.id),
            status: updatedOrder.status,
            serviceType: updatedOrder.serviceType,
            message: "Driver sedang menuju lokasi merchant untuk mengambil pesanan Anda.",
          });
        }
        // P0: manual accept also refreshes the accepting driver's dashboard.
        SocketService.emitToUser(userId, "order_accepted", {
          orderId: updatedOrder.id,
          orderNumber: getOrderNumber(updatedOrder.id),
          driverId: driverProfile.id,
        });
        SocketService.emitToDriversPool("order_taken", { orderId: updatedOrder.id });
        SocketService.emitToAdmins("order_accepted", { orderId: updatedOrder.id });
      } catch {
        // Socket.IO belum siap
      }

      return res.status(200).json({
        success: true,
        message: "Order berhasil diterima! Silakan jemput pelanggan.",
        order: {
          ...updatedOrder,
          driverPickupDistanceKm: pickupCompensation.driverPickupDistanceKm,
          driverPickupRatePerKm: pickupCompensation.driverPickupRatePerKm,
          driverPickupCompensation: pickupCompensation.driverPickupCompensation,
        },
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
        include: { customer: true, stops: { orderBy: { sequence: 'asc' } } },
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

      // MART mempunyai dua titik ARRIVED yang berbeda: merchant lalu customer.
      // Setelah tiba di merchant, driver WAJIB melakukan pickup sebelum boleh
      // menuju customer; order MART tidak boleh langsung COMPLETED dari ARRIVED.
      if (order.serviceType === 'MART') {
        const martAllowed: Record<OrderStatus, OrderStatus[]> = {
          PENDING: [],
          ACCEPTED: [OrderStatus.ON_THE_WAY, OrderStatus.CANCELLED],
          ON_THE_WAY: [OrderStatus.ARRIVED, OrderStatus.CANCELLED],
          ARRIVED: [OrderStatus.PICKED_UP, OrderStatus.CANCELLED],
          PICKED_UP: [OrderStatus.ARRIVED_CUSTOMER, OrderStatus.CANCELLED],
          ARRIVED_CUSTOMER: [OrderStatus.COMPLETED, OrderStatus.CANCELLED],
          COMPLETED: [],
          CANCELLED: [],
        };
        if (!(martAllowed[order.status] ?? []).includes(status)) {
          return res.status(400).json({
            error: `Lifecycle MART: status ${order.status} tidak boleh diubah menjadi ${status}.`,
          });
        }
      }

      if (status === OrderStatus.COMPLETED && order.serviceType !== 'MART' && order.stops.length > 0) {
        const unfinishedStops = order.stops.filter((stop) => stop.status !== 'COMPLETED');
        if (unfinishedStops.length > 0) {
          return res.status(409).json({
            error: `Masih ada ${unfinishedStops.length} tujuan yang belum selesai. Kunjungi seluruh tujuan secara berurutan sebelum menyelesaikan order.`,
          });
        }
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
          orderNumber: getOrderNumber(updatedOrder.id),
          status: updatedOrder.status,
          serviceType: updatedOrder.serviceType,
          pickupType: updatedOrder.serviceType === 'MART' ? 'MERCHANT' : 'CUSTOMER',
        });
        recipients.forEach((uid) =>
          SocketService.emitToUser(uid, "order_status_changed", {
            orderId: updatedOrder.id,
            orderNumber: getOrderNumber(updatedOrder.id),
            status: updatedOrder.status,
            serviceType: updatedOrder.serviceType,
            pickupType: updatedOrder.serviceType === 'MART' ? 'MERCHANT' : 'CUSTOMER',
          })
        );
        if (updatedOrder.serviceType === 'MART' && status === OrderStatus.ON_THE_WAY) {
          SocketService.emitToUser(order.customer.userId, "mart_driver_heading_to_merchant", {
            orderId: updatedOrder.id, orderNumber: getOrderNumber(updatedOrder.id), status: updatedOrder.status, serviceType: updatedOrder.serviceType,
            message: "Driver sedang menuju lokasi merchant untuk mengambil pesanan Anda.",
          });
        }
        if (updatedOrder.serviceType === 'MART' && status === OrderStatus.ARRIVED) {
          SocketService.emitToUser(order.customer.userId, "mart_driver_arrived_at_merchant", {
            orderId: updatedOrder.id, orderNumber: getOrderNumber(updatedOrder.id), status: updatedOrder.status, serviceType: updatedOrder.serviceType,
            message: "Driver telah tiba di lokasi merchant dan sedang mengambil pesanan Anda.",
          });
        }
        if (updatedOrder.serviceType === 'MART' && status === OrderStatus.PICKED_UP) {
          SocketService.emitToUser(order.customer.userId, "mart_driver_heading_to_customer", {
            orderId: updatedOrder.id, orderNumber: getOrderNumber(updatedOrder.id), status: updatedOrder.status, serviceType: updatedOrder.serviceType,
            message: "Pesanan sudah diambil driver dan sedang menuju lokasi Anda.",
          });
        }
        if (updatedOrder.serviceType === 'MART' && status === OrderStatus.ARRIVED_CUSTOMER) {
          SocketService.emitToUser(order.customer.userId, "mart_driver_arrived_at_customer", {
            orderId: updatedOrder.id, orderNumber: getOrderNumber(updatedOrder.id), status: updatedOrder.status, serviceType: updatedOrder.serviceType,
            message: "Driver telah tiba di lokasi Anda.",
          });
        }
        if (status === OrderStatus.COMPLETED) {
          const externalPaymentPending = !updatedOrder.isPaid && ['QRIS', 'TRANSFER', 'EWALLET'].includes(updatedOrder.paymentMethod);
          if (externalPaymentPending) {
            const paymentPayload = {
              orderId,
              orderNumber: getOrderNumber(orderId),
              paymentMethod: updatedOrder.paymentMethod,
              message: `Perjalanan sudah tiba di tujuan. Upload bukti bayar ${updatedOrder.paymentMethod} agar order dapat ditutup setelah disetujui Admin.`,
            };
            SocketService.emitToOrder(orderId, 'payment_proof_required', paymentPayload);
            SocketService.emitToUser(order.customer.userId, 'payment_proof_required', paymentPayload);
            SocketService.emitToUser(userId, 'payment_pending', paymentPayload);
          } else {
            SocketService.emitToOrder(orderId, "order_completed", { orderId });
            recipients.forEach((uid) => SocketService.emitToUser(uid, "order_completed", { orderId }));
          }
        }
        if (status === OrderStatus.CANCELLED) {
          SocketService.emitToOrder(orderId, "order_cancelled", { orderId });
          recipients.forEach((uid) => SocketService.emitToUser(uid, "order_cancelled", { orderId }));
        }
        SocketService.emitToAdmins("order_status_changed", { orderId, orderNumber: getOrderNumber(orderId), status });
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
          // 🆕 FIX P0 "Financial State Machine" (audit a1.4 & audit
          // driver-jobs): route ini adalah JALUR KEDUA yang memicu
          // auto-debit saat order COMPLETED (terpisah dari
          // OrderService.updateStatus() yang sudah lebih dulu diperbaiki
          // -- lihat komentar lengkap di sana) -- SEBELUMNYA jalur ini
          // TERLEWAT dari fix yang sama: kegagalan auto-debit di sini
          // HANYA memicu event Socket.IO sesaat, TANPA settlementStatus
          // eksplisit, TANPA AuditLogger durable, TANPA alert admin.
          // Order yang COMPLETED lewat endpoint driver INI (bukan lewat
          // OrderService) bisa diam-diam menggantung tanpa jejak apa
          // pun kalau customer sedang offline saat itu terjadi.
          //
          // Disamakan sekarang dengan pola di OrderService.updateStatus():
          // settlementStatus -> RETRY_REQUIRED (durable, muncul di
          // ReconciliationService.listPendingReconciliation()), dicatat
          // AuditLogger, dan alert real-time ke admin.
          autoDebitFailed = true;
          try {
            await prisma.order.update({
              where: { id: orderId },
              data: { settlementStatus: 'RETRY_REQUIRED' },
            });
            await AuditLogger.log(
              order.customer.userId,
              'PAYMENT_SETTLEMENT_FAILED',
              `Order #${orderId} COMPLETED (lewat driver job status) tapi auto-debit wallet gagal: ${err?.message || err}. settlementStatus=RETRY_REQUIRED, PERLU DIRETRY (lihat ReconciliationService).`
            );
            SocketService.emitToAdmins('payment_settlement_failed', {
              orderId,
              error: err?.message || String(err),
            });
          } catch (recordError) {
            console.error(`[SETTLEMENT] Gagal mencatat RETRY_REQUIRED untuk order ${orderId}:`, recordError);
          }

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
              : ['QRIS', 'TRANSFER', 'EWALLET'].includes(updatedOrder.paymentMethod)
                ? ` Perjalanan sudah tiba di tujuan. Menunggu customer upload bukti bayar ${updatedOrder.paymentMethod} dan approval Admin sebelum dashboard dibuka.`
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
