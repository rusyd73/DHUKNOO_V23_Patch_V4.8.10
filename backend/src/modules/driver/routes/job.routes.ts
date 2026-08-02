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

const paymentService = new PaymentService();

const router = Router();
export { router as jobRouter };

/*
|--------------------------------------------------------------------------
| Valid State Transition
|--------------------------------------------------------------------------
| NOTE: memakai OrderStatus yang SUNGGUH ADA di prisma/schema.prisma
| (PENDING, ACCEPTED, ON_THE_WAY, ARRIVED, COMPLETED, CANCELLED).
| Versi sebelumnya sempat memakai nama status hasil refactor
| (ARRIVED_PICKUP/IN_PROGRESS/SEARCHING_DRIVER) yang TIDAK PERNAH
| dimigrasikan ke schema.prisma — itulah salah satu "link" yang hilang.
*/
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

// GET /api/driver/jobs - Job pool (PENDING) + order yang sedang ditangani driver ini
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

      const driverProfile = await prisma.driverProfile.findUnique({
        where: { userId },
      });

      if (!driverProfile) {
        return res.status(404).json({ error: 'Profil driver tidak ditemukan!' });
      }

      const jobs = await prisma.order.findMany({
        where: {
          OR: [
            { status: OrderStatus.PENDING },
            { driverId: driverProfile.id },
          ],
        },
        include: {
          customer: {
            include: {
              user: {
                select: { fullName: true, email: true },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      return res.status(200).json({ jobs });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }
);

// POST /api/driver/jobs/:orderId/accept - Terima lowongan order (atomic, anti race condition)
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

      const driverProfile = await prisma.driverProfile.findUnique({ where: { userId } });

      if (!driverProfile) {
        return res.status(404).json({ error: "Profil driver tidak ditemukan!" });
      }

      if (!driverProfile.isVerified) {
        return res.status(403).json({ error: "Akun belum diverifikasi!" });
      }

      // Driver hanya boleh punya SATU order aktif dalam satu waktu.
      const activeOrder = await prisma.order.findFirst({
        where: { driverId: driverProfile.id, status: { in: ACTIVE_STATUSES } },
      });

      if (activeOrder) {
        return res.status(409).json({
          error: "Selesaikan order yang sedang berjalan sebelum menerima order baru.",
        });
      }

      // BEKUKAN: driver yang punya order CASH sebelumnya sudah COMPLETED
      // tapi BELUM dikonfirmasi lunas (isPaid masih false) tidak boleh
      // menerima order baru apa pun sampai konfirmasi uang tunai diterima
      // lewat /api/payment/confirm-cash.
      const unconfirmedCash = await prisma.order.findFirst({
        where: { driverId: (driverProfile as any).id, status: "COMPLETED", paymentMethod: "CASH", isPaid: false },
        select: { id: true },
      });
      if (unconfirmedCash) {
        return res.status(403).json({
          error: `Anda masih punya pembayaran CASH order #${unconfirmedCash.id} yang belum dikonfirmasi diterima. Konfirmasi dulu sebelum bisa menerima order baru.`,
        });
      }

      // Gerbang deposit: saldo di bawah minimum tidak boleh menerima order.
      const driverWallet = await prisma.wallet.findUnique({ where: { userId } });
      const minimumDeposit = await new TariffEngineService().getMinimumDriverDeposit();
      const currentBalance = Number(driverWallet?.balance ?? 0);

      if (currentBalance < minimumDeposit) {
        return res.status(403).json({
          error:
            `Saldo deposit Anda (Rp${currentBalance.toLocaleString("id-ID")}) ` +
            `belum memenuhi minimum Rp${minimumDeposit.toLocaleString("id-ID")}.`,
        });
      }

      // KUNCI KLASIFIKASI: driver motor tidak boleh ambil order mobil, dsb —
      // dicek terhadap jenis layanan yang didaftarkan driver ini.
      //
      // PENGECUALIAN: order layanan SEND (kirim barang) TIDAK memakai
      // klasifikasi -- driver BIKE maupun CAR yang online boleh langsung
      // menerima order SEND, tanpa perlu serviceType profil mereka SEND.
      const orderToClaim = await prisma.order.findUnique({ where: { id: orderId }, select: { serviceType: true } });
      if (!orderToClaim) {
        return res.status(404).json({ error: "Order tidak ditemukan!" });
      }
      if (orderToClaim.serviceType !== "SEND" && orderToClaim.serviceType !== (driverProfile as any).serviceType) {
        return res.status(403).json({
          error: `Order ini untuk layanan ${orderToClaim.serviceType}, sedangkan akun Anda terdaftar sebagai driver ${(driverProfile as any).serviceType}.`,
        });
      }

      // Atomic accept: updateMany dengan guard status:PENDING mencegah dua driver
      // sama-sama "berhasil" menerima order yang sama (race condition).
      const updatedOrder = await prisma.$transaction(async (tx) => {
        const result = await tx.order.updateMany({
          where: { id: orderId, status: OrderStatus.PENDING },
          data: { status: OrderStatus.ACCEPTED, driverId: driverProfile.id, acceptedAt: new Date() },
        });

        if (result.count === 0) {
          throw new Error("ORDER_ALREADY_ACCEPTED");
        }

        const orderAfterUpdate = await tx.order.findUnique({
          where: { id: orderId },
          include: { customer: true },
        });

        if (!orderAfterUpdate) {
          throw new Error("ORDER_NOT_FOUND");
        }

        await AuditLogger.log(userId, "DRIVER_ACCEPT_ORDER", `Mengambil order #${orderId}`, tx);

        return orderAfterUpdate;
      });

      // Realtime — disiarkan ke room order, room pribadi customer, dan seluruh admin.
      try {
        SocketService.emitToOrder(updatedOrder.id, "order_status_changed", {
          orderId: updatedOrder.id,
          status: updatedOrder.status,
          driverId: driverProfile.id,
        });
        SocketService.emitToUser(updatedOrder.customer.userId, "order_accepted", {
          orderId: updatedOrder.id,
          driverId: driverProfile.id,
        });
        SocketService.emitToDriversPool("order_taken", { orderId: updatedOrder.id });
        SocketService.emitToAdmins("order_accepted", { orderId: updatedOrder.id });
      } catch {
        // Socket.IO belum siap — abaikan, order tetap berhasil diambil.
      }

      return res.status(200).json({
        message: "Order berhasil diterima! Silakan jemput pelanggan.",
        order: updatedOrder,
      });
    } catch (err: any) {
      if (err.message === "ORDER_ALREADY_ACCEPTED") {
        return res.status(409).json({ error: "Order sudah diterima driver lain." });
      }
      if (err.message === "ORDER_NOT_FOUND") {
        return res.status(404).json({ error: "Order tidak ditemukan." });
      }
      console.error(err);
      return res.status(500).json({ error: "Internal Server Error" });
    }
  }
);

// POST /api/driver/jobs/:orderId/status - Ubah status perjalanan (atomic, validasi transisi)
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

      const driverProfile = await prisma.driverProfile.findUnique({ where: { userId } });

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

        const orderAfterUpdate = await tx.order.findUnique({ where: { id: orderId } });

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

      // Realtime — ke room order DAN room pribadi customer+driver, supaya sampai walau
      // client belum sempat join room order_<id> secara manual.
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
        // Socket.IO belum siap — abaikan.
      }

      // PERBAIKAN: endpoint INI (bukan OrderService.updateStatus) yang benar-benar
      // dipanggil oleh tombol "Selesai" di dashboard driver (DriverAPI.updateJobStatus
      // -> /api/driver/jobs/:orderId/status). Order dengan metode bayar WALLET (saldo)
      // harus AUTO DEBET begitu trip COMPLETED -- customer TIDAK perlu klik "Bayar
      // Sekarang" manual. Sebelumnya endpoint ini TIDAK PERNAH memicu pembayaran sama
      // sekali (cuma menyuruh customer bayar manual lewat endpoint payment terpisah),
      // jadi riwayat perjalanan customer selalu menampilkan status BELUM LUNAS untuk
      // order WALLET yang sudah selesai. Kegagalan auto-debet (mis. saldo kurang)
      // TIDAK menggagalkan penyelesaian trip -- order tetap COMPLETED, customer
      // diberi tahu lewat event realtime supaya top-up & bayar manual.
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
            // Socket.IO belum siap — abaikan.
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
        message: `Status order berhasil diperbarui ke ${status}!${note}`,
        order: finalOrder,
      });
    } catch (err: any) {
      if (err.message === "ORDER_STATUS_CHANGED") {
        return res.status(409).json({
          error: "Status order telah berubah oleh proses lain. Silakan refresh data.",
        });
      }
      if (err.message === "ORDER_NOT_FOUND") {
        return res.status(404).json({ error: "Order tidak ditemukan." });
      }
      console.error(err);
      return res.status(500).json({ error: "Internal Server Error" });
    }
  }
);
