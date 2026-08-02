import { Server as HttpServer } from "http";
import { Server, Socket } from "socket.io";
import jwt from "jsonwebtoken";
import { logger } from "../config/logger";
import { ENV } from "../config/env";
import { prisma } from "../config/prisma";
// 🔥 TAMBAHKAN IMPORT UNTUK REDIS
import { RedisService } from "../config/redis";

type SocketRole = "CUSTOMER" | "DRIVER" | "ADMIN" | "MERCHANT";

interface SocketUser {
  id: string;
  email: string;
  role: SocketRole;
}

interface SocketData {
  user: SocketUser;
}

type AppServer = Server<any, any, any, SocketData>;
type AppSocket = Socket<any, any, any, SocketData>;

const LOCATION_UPDATE_MIN_INTERVAL_MS = 2000; // maksimal 1 update lokasi / 2 detik / socket
const CHAT_MESSAGE_MIN_INTERVAL_MS = 400; // anti flood chat sederhana
const SOCKET_PREFIX = 'socket:driver:'; // 🔥 Prefix untuk Redis key

/**
 * Keamanan Socket.IO:
 * 1. Setiap koneksi WAJIB mengirim JWT (sama seperti REST API) lewat
 *    `socket.handshake.auth.token`. Koneksi tanpa token / token invalid ditolak
 *    di tahap handshake (io.use), sebelum event apa pun bisa dikirim.
 * 2. Setiap client OTOMATIS di-join ke room pribadinya (`user_<userId>`) supaya
 *    emitToUser() selalu sampai ke semua device/tab milik user itu, dan admin
 *    di-join ke room "admins" untuk broadcast operasional (dashboard admin realtime).
 * 3. Join ke room sensitif (`order_<id>`, `driver_<id>`) diverifikasi ke database
 *    dulu — client tidak bisa asal join room order/driver milik orang lain.
 * 4. Event yang mengubah data (driver_location_update, send_chat_message)
 *    diverifikasi kepemilikan/keterlibatan pengirim, dan dibatasi laju (rate-limited)
 *    supaya satu client nakal tidak bisa membanjiri seluruh server.
 */
export class SocketService {
  private static io: AppServer | null = null;
  private static lastLocationEmitAt = new Map<string, number>();
  private static lastChatEmitAt = new Map<string, number>();

  public static init(server: HttpServer): AppServer {
    const allowedOrigins = ENV.ALLOWED_ORIGINS.length > 0 ? ENV.ALLOWED_ORIGINS : "*";
    if (allowedOrigins === "*") {
      logger.warn(
        "[SocketService] ALLOWED_ORIGINS belum diset — Socket.IO menerima koneksi dari SEMUA origin. " +
          "Set env ALLOWED_ORIGINS di production!"
      );
    }

    this.io = new Server<any, any, any, SocketData>(server, {
      cors: {
        origin: allowedOrigins,
        methods: ["GET", "POST"],
        credentials: true,
      },
    });

    // ── 1. Autentikasi wajib di handshake ───────────────────────────────
    this.io.use((socket, next) => {
      try {
        const token =
          socket.handshake.auth?.token ||
          (socket.handshake.headers.authorization || "").toString().replace(/^Bearer\s+/i, "");

        if (!token) {
          return next(new Error("UNAUTHORIZED: token tidak ditemukan"));
        }

        const decoded = jwt.verify(token, ENV.JWT_SECRET) as SocketUser;
        socket.data.user = {
          id: decoded.id,
          email: decoded.email,
          role: decoded.role,
        };
        next();
      } catch (err) {
        logger.warn(`[SocketService] Auth handshake ditolak: ${(err as Error).message}`);
        next(new Error("UNAUTHORIZED: token tidak valid atau kedaluwarsa"));
      }
    });

    this.io.on("connection", (socket: AppSocket) => {
      const user = socket.data.user;
      logger.info(`Socket client connected: ${socket.id} (user=${user.id}, role=${user.role})`);

      // Room pribadi otomatis — dipakai emitToUser()
      socket.join(`user_${user.id}`);
      if (user.role === "ADMIN") {
        socket.join("admins");
      }

      // ──────────────────────────────────────────────────────────────────
      // 🔥 EVENT HANDLER YANG SUDAH ADA (TIDAK DIUBAH)
      // ──────────────────────────────────────────────────────────────────

      /**
       * Join Room — diverifikasi dulu supaya user tidak bisa memantau
       * order/driver milik orang lain hanya dengan menebak ID.
       */
      socket.on("join_room", async (roomId: string, ack?: (ok: boolean, reason?: string) => void) => {
        try {
          const authorized = await SocketService.canJoinRoom(user, roomId);
          if (!authorized) {
            logger.warn(`[ROOM] Ditolak: ${socket.id} (${user.id}/${user.role}) -> ${roomId}`);
            ack?.(false, "Tidak berwenang bergabung ke room ini.");
            return;
          }

          socket.join(roomId);
          logger.info(`[ROOM] ${socket.id} -> ${roomId}`);
          ack?.(true);
        } catch (err) {
          logger.error(`[ROOM] Error saat join_room: ${(err as Error).message}`);
          ack?.(false, "Terjadi kesalahan server.");
        }
      });

      /**
       * Driver mengirim lokasi realtime — hanya driver pemilik akun yang boleh
       * mengirim update untuk driverId tersebut, dan dibatasi laju pengiriman.
       */
      socket.on(
        "driver_location_update",
        async (data: { driverId: string; lat: number; lng: number; speed?: number; heading?: number }) => {
          if (!this.io) return;
          if (user.role !== "DRIVER") return;

          const now = Date.now();
          const last = this.lastLocationEmitAt.get(socket.id) || 0;
          if (now - last < LOCATION_UPDATE_MIN_INTERVAL_MS) return; // throttle
          this.lastLocationEmitAt.set(socket.id, now);

          const driverProfile = await prisma.driverProfile.findUnique({ where: { userId: user.id } });
          if (!driverProfile || driverProfile.id !== data.driverId) {
            logger.warn(`[LOCATION] Ditolak: user ${user.id} mencoba mengirim lokasi untuk driverId ${data.driverId}`);
            return;
          }

          const payload = { driverId: data.driverId, lat: data.lat, lng: data.lng, speed: data.speed, heading: data.heading };

          this.io.to("map_updates").emit("location_changed", payload);
          this.io.to(`driver_${data.driverId}`).emit("location_changed", payload);

          // Kalau driver sedang punya order aktif, siarkan juga ke room order itu
          // supaya peta customer ikut bergerak realtime tanpa perlu subscribe manual.
          const activeOrder = await prisma.order.findFirst({
            where: { driverId: driverProfile.id, status: { in: ["ACCEPTED", "ON_THE_WAY", "ARRIVED"] } },
            select: { id: true },
          });
          if (activeOrder) {
            this.io.to(`order_${activeOrder.id}`).emit("location_changed", payload);
          }
        }
      );

      /**
       * Chat Customer <-> Driver — hanya partisipan order (atau admin) yang boleh kirim.
       */
      socket.on("send_chat_message", async (data: { orderId: string; sender: string; message: string }) => {
        if (!this.io) return;
        if (!data?.orderId || !data?.message?.trim()) return;

        const now = Date.now();
        const last = this.lastChatEmitAt.get(socket.id) || 0;
        if (now - last < CHAT_MESSAGE_MIN_INTERVAL_MS) return; // anti-flood
        this.lastChatEmitAt.set(socket.id, now);

        const authorized = await SocketService.isOrderParticipant(user, data.orderId);
        if (!authorized) {
          logger.warn(`[CHAT] Ditolak: user ${user.id} bukan partisipan order ${data.orderId}`);
          return;
        }

        const trimmedMessage = data.message.trim().slice(0, 1000);

        let saved;
        try {
          saved = await prisma.chatMessage.create({
            data: {
              orderId: data.orderId,
              senderId: user.id,
              senderRole: user.role as any,
              message: trimmedMessage,
            },
          });
        } catch (err) {
          logger.error(`[CHAT] Gagal menyimpan pesan: ${(err as Error).message}`);
          return;
        }

        const payload = {
          orderId: data.orderId,
          sender: user.id,
          senderRole: user.role,
          message: trimmedMessage,
          sentAt: saved.createdAt.toISOString(),
        };

        this.io.to(`order_${data.orderId}`).emit("new_chat_message", payload);
        logger.info(`Chat Order ${data.orderId} : ${user.role}(${user.id})`);
      });

      /**
       * PERBAIKAN: Telepon In-App (VoIP) Customer <-> Driver — sebelumnya
       * frontend (InAppVoipCall.tsx) sudah emit call_initiate/call_answer/
       * call_reject/call_end, TAPI backend TIDAK PERNAH mendengarkan event
       * ini sama sekali. Akibatnya panggilan tidak pernah "terhubung"
       * (stuck di status CALLING/Memanggil... selamanya) karena sinyal
       * panggilan tidak pernah diteruskan ke pihak lain — beda dengan jalur
       * chat (send_chat_message) yang sudah benar di-relay ke room order.
       * Di sini dipakai pola yang SAMA PERSIS seperti send_chat_message:
       * verifikasi partisipan order, lalu broadcast ke room `order_<id>`.
       */
      socket.on("call_initiate", async (data: { orderId: string; callerId: string; callerName?: string; callerRole?: string }) => {
        if (!this.io) return;
        if (!data?.orderId) return;

        const authorized = await SocketService.isOrderParticipant(user, data.orderId);
        if (!authorized) {
          logger.warn(`[CALL] Ditolak inisiasi panggilan: user ${user.id} bukan partisipan order ${data.orderId}`);
          return;
        }

        this.io.to(`order_${data.orderId}`).emit("call_incoming", {
          orderId: data.orderId,
          callerId: user.id,
          callerName: data.callerName,
          callerRole: data.callerRole || user.role,
        });
        logger.info(`[CALL] Inisiasi panggilan order ${data.orderId} oleh ${user.role}(${user.id})`);
      });

      socket.on("call_answer", async (data: { orderId: string; responderId: string }) => {
        if (!this.io) return;
        if (!data?.orderId) return;

        const authorized = await SocketService.isOrderParticipant(user, data.orderId);
        if (!authorized) {
          logger.warn(`[CALL] Ditolak jawab panggilan: user ${user.id} bukan partisipan order ${data.orderId}`);
          return;
        }

        this.io.to(`order_${data.orderId}`).emit("call_accepted", {
          orderId: data.orderId,
          responderId: user.id,
        });
        logger.info(`[CALL] Panggilan dijawab order ${data.orderId} oleh ${user.role}(${user.id})`);
      });

      socket.on("call_reject", async (data: { orderId: string; rejecterId: string; reason?: string }) => {
        if (!this.io) return;
        if (!data?.orderId) return;

        const authorized = await SocketService.isOrderParticipant(user, data.orderId);
        if (!authorized) {
          logger.warn(`[CALL] Ditolak tolak-panggilan: user ${user.id} bukan partisipan order ${data.orderId}`);
          return;
        }

        this.io.to(`order_${data.orderId}`).emit("call_rejected", {
          orderId: data.orderId,
          rejecterId: user.id,
          reason: data.reason,
        });
        logger.info(`[CALL] Panggilan ditolak order ${data.orderId} oleh ${user.role}(${user.id})`);
      });

      socket.on("call_end", async (data: { orderId: string; enderId: string; durationSeconds?: number }) => {
        if (!this.io) return;
        if (!data?.orderId) return;

        const authorized = await SocketService.isOrderParticipant(user, data.orderId);
        if (!authorized) {
          logger.warn(`[CALL] Ditolak akhiri panggilan: user ${user.id} bukan partisipan order ${data.orderId}`);
          return;
        }

        this.io.to(`order_${data.orderId}`).emit("call_ended", {
          orderId: data.orderId,
          enderId: user.id,
          durationSeconds: data.durationSeconds,
        });
        logger.info(`[CALL] Panggilan diakhiri order ${data.orderId} oleh ${user.role}(${user.id}) — durasi ${data.durationSeconds ?? 0}s`);
      });

      // ──────────────────────────────────────────────────────────────────
      // 🔥 EVENT HANDLER BARU UNTUK DRIVER TOGGLE & PUBLISH ORDER
      // ──────────────────────────────────────────────────────────────────

      /**
       * DRIVER REGISTER - Menghubungkan driver ke socket
       */
      socket.on("driver-register", async (data: { driverId: string; name: string }) => {
        try {
          const { driverId, name } = data;

          // Validasi: hanya driver yang boleh register
          if (user.role !== "DRIVER") {
            socket.emit("error", { message: "Only DRIVER can register" });
            return;
          }

          // Validasi: driverId harus sama dengan user.id
          if (driverId !== user.id) {
            socket.emit("error", { message: "Driver ID mismatch" });
            return;
          }

          // Simpan di Redis untuk tracking
          await RedisService.setex(
            `${SOCKET_PREFIX}${driverId}`,
            60 * 60 * 24 * 7, // 7 hari
            socket.id
          );

          // Join room khusus driver
          socket.join(`driver-${driverId}`);
          logger.info(`✅ Driver ${name} (${driverId}) registered`);

          socket.emit("register-success", {
            message: "Driver registered successfully",
            driverId
          });

          // Kirim order PENDING yang sesuai dengan serviceType driver
          const driver = await prisma.driverProfile.findUnique({
            where: { userId: driverId },
            include: { user: true }
          });

          if (driver && driver.isOnline) {
            const pendingOrders = await prisma.order.findMany({
              where: {
                status: "PENDING",
                serviceType: driver.serviceType,
              },
              include: {
                customer: {
                  include: { user: true }
                }
              },
              orderBy: { createdAt: "desc" },
              take: 20
            });

            if (pendingOrders.length > 0) {
              logger.info(`📦 Sending ${pendingOrders.length} pending orders to ${name}`);
              pendingOrders.forEach(order => {
                socket.emit("new-order", order);
              });
            }
          }

        } catch (error) {
          logger.error("Driver register error:", error);
          socket.emit("error", { message: "Failed to register driver" });
        }
      });

      /**
       * 🔥 TOGGLE READY - FIX UTAMA
       * Driver mengaktifkan/menonaktifkan status siap menerima order
       */
      socket.on("driver-toggle-ready", async (data: { driverId: string; isReady: boolean }) => {
        try {
          const { driverId, isReady } = data;

          // Validasi: hanya driver yang boleh toggle
          if (user.role !== "DRIVER") {
            socket.emit("error", { message: "Only DRIVER can toggle" });
            return;
          }

          // Validasi: driverId harus sama dengan user.id
          if (driverId !== user.id) {
            socket.emit("error", { message: "Driver ID mismatch" });
            return;
          }

          // Update database
          const driver = await prisma.driverProfile.update({
            where: { userId: driverId },
            data: {
              isOnline: isReady,
              autoAcceptEnabled: isReady,
            },
            include: { user: true }
          });

          logger.info(`🔄 Driver ${driver.user.fullName} toggled: ${isReady ? "ONLINE ✅" : "OFFLINE ❌"}`);

          // Broadcast ke semua client
          this.io?.emit("driver_status_changed", {
            driverId,
            driverName: driver.user.fullName,
            isOnline: driver.isOnline,
            autoAccept: driver.autoAcceptEnabled,
            serviceType: driver.serviceType
          });

          // Jika ONLINE, kirim order PENDING
          if (isReady) {
            const pendingOrders = await prisma.order.findMany({
              where: {
                status: "PENDING",
                serviceType: driver.serviceType,
              },
              include: {
                customer: {
                  include: { user: true }
                }
              },
              orderBy: { createdAt: "desc" },
              take: 20
            });

            if (pendingOrders.length > 0) {
              logger.info(`📦 Sending ${pendingOrders.length} orders to ${driver.user.fullName}`);
              pendingOrders.forEach(order => {
                this.io?.to(`driver-${driverId}`).emit("new-order", order);
              });
            } else {
              socket.emit("no-orders", {
                message: `Tidak ada order ${driver.serviceType} yang tersedia`
              });
            }
          }

          socket.emit("toggle-success", {
            message: `Status ${isReady ? "ONLINE" : "OFFLINE"}`,
            isReady,
            driverId
          });

        } catch (error) {
          logger.error("Toggle error:", error);
          socket.emit("error", { message: "Failed to toggle status" });
        }
      });

      /**
       * PUBLISH ORDER - Dari Admin/Merchant
       */
      socket.on("publish-order", async (data: {
        pickup: string;
        destination: string;
        pickupLat?: number;
        pickupLng?: number;
        dropoffLat?: number;
        dropoffLng?: number;
        serviceType?: "BIKE" | "CAR" | "SEND";
        price?: number;
        customerId?: string;
      }) => {
        try {
          // Validasi: hanya ADMIN atau MERCHANT yang boleh publish
          if (user.role !== "ADMIN" && user.role !== "MERCHANT") {
            socket.emit("error", { message: "Only ADMIN or MERCHANT can publish order" });
            return;
          }

          // Cari customer default
          let customerId = data.customerId;
          if (!customerId) {
            const defaultCustomer = await prisma.customerProfile.findFirst({
              include: { user: true }
            });
            if (defaultCustomer) {
              customerId = defaultCustomer.id;
            } else {
              // Buat customer temporary
              const newUser = await prisma.user.create({
                data: {
                  email: `temp_${Date.now()}@temp.com`,
                  passwordHash: "temporary",
                  fullName: "Customer Temp",
                  role: "CUSTOMER",
                  customerProfile: {
                    create: {
                      phoneNumber: "081234567890"
                    }
                  }
                }
              });
              const profile = await prisma.customerProfile.findUnique({
                where: { userId: newUser.id }
              });
              customerId = profile!.id;
            }
          }

          const serviceType = data.serviceType || "BIKE";
          const price = data.price || 15000;

          // Buat order
          const newOrder = await prisma.order.create({
            data: {
              serviceType,
              status: "PENDING",
              price,
              discount: 0,
              isPaid: false,
              paymentMethod: "WALLET",
              pickupAddress: data.pickup,
              pickupLat: data.pickupLat || -7.8711,
              pickupLng: data.pickupLng || 112.5269,
              dropoffAddress: data.destination,
              dropoffLat: data.dropoffLat || -7.8785,
              dropoffLng: data.dropoffLng || 112.5204,
              distanceKm: 3,
              customerId: customerId,
            },
            include: {
              customer: {
                include: { user: true }
              }
            }
          });

          logger.info(`📤 New order published: ${newOrder.id} (${serviceType})`);

          // Cari driver yang ONLINE & sesuai SERVICE TYPE
          const availableDrivers = await prisma.driverProfile.findMany({
            where: {
              isOnline: true,
              autoAcceptEnabled: true,
              serviceType: serviceType,
            },
            include: { user: true }
          });

          if (availableDrivers.length > 0) {
            logger.info(`🚀 Sending order to ${availableDrivers.length} matching drivers`);

            availableDrivers.forEach(driver => {
              this.io?.to(`driver-${driver.userId}`).emit("new-order", newOrder);
            });

            this.io?.emit("order-published", {
              order: newOrder,
              matchedDrivers: availableDrivers.length,
              drivers: availableDrivers.map(d => d.user.fullName)
            });

            socket.emit("publish-success", {
              message: `Order published to ${availableDrivers.length} drivers`,
              order: newOrder,
              matchedDrivers: availableDrivers.length
            });

          } else {
            logger.warn(`⚠️ No online drivers for service type: ${serviceType}`);
            this.io?.emit("order-waiting", {
              order: newOrder,
              message: `Menunggu driver ${serviceType} siap...`
            });

            socket.emit("publish-success", {
              message: "Order published, waiting for drivers...",
              order: newOrder,
              matchedDrivers: 0
            });
          }

        } catch (error) {
          logger.error("Publish order error:", error);
          socket.emit("error", { message: "Failed to publish order" });
        }
      });

      /**
       * ACCEPT ORDER - Driver menerima order
       */
      socket.on("accept-order", async (data: { driverId: string; orderId: string }) => {
        try {
          const { driverId, orderId } = data;

          // Validasi: hanya driver yang boleh accept
          if (user.role !== "DRIVER") {
            socket.emit("error", { message: "Only DRIVER can accept order" });
            return;
          }

          // Validasi: driverId harus sama dengan user.id
          if (driverId !== user.id) {
            socket.emit("error", { message: "Driver ID mismatch" });
            return;
          }

          const order = await prisma.order.findUnique({
            where: { id: orderId },
            include: { customer: { include: { user: true } } }
          });

          if (!order) {
            socket.emit("error", { message: "Order not found" });
            return;
          }

          if (order.status !== "PENDING") {
            socket.emit("error", { message: "Order already taken" });
            return;
          }

          const driver = await prisma.driverProfile.findUnique({
            where: { userId: driverId },
            include: { user: true }
          });

          if (!driver) {
            socket.emit("error", { message: "Driver not found" });
            return;
          }

          // Cek klasifikasi
          if (order.serviceType !== driver.serviceType) {
            socket.emit("error", {
              message: `You can only accept ${driver.serviceType} orders. This is ${order.serviceType}`
            });
            return;
          }

          // Accept order
          const updatedOrder = await prisma.order.update({
            where: { id: orderId },
            data: {
              status: "ACCEPTED",
              driverId: driverId,
              acceptedAt: new Date(),
            },
            include: {
              customer: { include: { user: true } },
              driver: { include: { user: true } }
            }
          });

          // Set driver offline
          await prisma.driverProfile.update({
            where: { userId: driverId },
            data: { isOnline: false, autoAcceptEnabled: false }
          });

          // Hapus dari Redis
          await RedisService.del(`${SOCKET_PREFIX}${driverId}`);

          // Broadcast
          this.io?.emit("order_updated", updatedOrder);
          this.io?.emit("order_accepted", {
            orderId: updatedOrder.id,
            driver: {
              id: driver.userId,
              name: driver.user.fullName,
              vehicle: driver.vehicleModel,
              plate: driver.vehiclePlate
            },
            order: updatedOrder
          });

          this.io?.to(`driver-${driverId}`).emit("order-accepted", {
            orderId: updatedOrder.id,
            message: "✅ Order berhasil diterima!",
            order: updatedOrder
          });

          this.io?.to(orderId).emit("driver_assigned", {
            orderId: updatedOrder.id,
            driver: {
              name: driver.user.fullName,
              phone: driver.phoneNumber,
              vehicle: driver.vehicleModel,
              plate: driver.vehiclePlate
            }
          });

          logger.info(`✅ Order ${orderId} accepted by driver ${driver.user.fullName}`);
          socket.emit("accept-success", { orderId, driverId });

        } catch (error) {
          logger.error("Accept order error:", error);
          socket.emit("error", { message: "Failed to accept order" });
        }
      });

      // ──────────────────────────────────────────────────────────────────
      // 🔥 DISCONNECT - Cleanup
      // ──────────────────────────────────────────────────────────────────

      socket.on("disconnect", async () => {
        this.lastLocationEmitAt.delete(socket.id);
        this.lastChatEmitAt.delete(socket.id);
        logger.info(`Socket disconnected : ${socket.id}`);

        // 🔥 Cleanup Redis untuk driver
        try {
          const keys = await RedisService.keys(`${SOCKET_PREFIX}*`);
          for (const key of keys) {
            const socketId = await RedisService.get(key);
            if (socketId === socket.id) {
              const driverId = key.replace(SOCKET_PREFIX, "");
              await RedisService.del(key);

              await prisma.driverProfile.update({
                where: { userId: driverId },
                data: { isOnline: false }
              });

              logger.info(`🔴 Driver ${driverId} disconnected, set offline`);
              break;
            }
          }
        } catch (error) {
          logger.error("Disconnect cleanup error:", error);
        }
      });
    });

    logger.info("Socket.IO initialized (auth + room authorization enabled).");

    return this.io;
  }

  /** Otorisasi join_room: order_<id>, driver_<id>, map_updates, drivers_pool. */
  private static async canJoinRoom(user: SocketUser, roomId: string): Promise<boolean> {
    if (user.role === "ADMIN") return true; // admin boleh memantau semua room

    if (roomId === "map_updates" || roomId === "drivers_pool") {
      return true; // read-only, tidak membocorkan data sensitif per-individu
    }

    if (roomId.startsWith("order_")) {
      const orderId = roomId.slice("order_".length);
      return SocketService.isOrderParticipant(user, orderId);
    }

    if (roomId.startsWith("driver_")) {
      const driverId = roomId.slice("driver_".length);
      if (user.role === "DRIVER") {
        const driverProfile = await prisma.driverProfile.findUnique({ where: { userId: user.id } });
        if (driverProfile?.id === driverId) return true;
      }
      // Customer boleh subscribe room driver HANYA jika driver itu sedang
      // menangani salah satu order milik customer tsb (untuk lacak peta).
      if (user.role === "CUSTOMER") {
        const customerProfile = await prisma.customerProfile.findUnique({ where: { userId: user.id } });
        if (!customerProfile) return false;
        const activeOrder = await prisma.order.findFirst({
          where: { customerId: customerProfile.id, driverId, status: { in: ["ACCEPTED", "ON_THE_WAY", "ARRIVED"] } },
          select: { id: true },
        });
        return !!activeOrder;
      }
      return false;
    }

    if (roomId === `user_${user.id}`) return true;

    // Room tak dikenal / tidak eksplisit diizinkan -> tolak by default (fail-closed).
    return false;
  }

  private static async isOrderParticipant(user: SocketUser, orderId: string): Promise<boolean> {
    if (user.role === "ADMIN") return true;
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { customer: true, driver: true },
    });
    if (!order) return false;
    if (user.role === "CUSTOMER") return order.customer.userId === user.id;
    if (user.role === "DRIVER") return order.driver?.userId === user.id;
    return false;
  }

  public static getIO(): AppServer {
    if (!this.io) {
      throw new Error("Socket.IO belum diinisialisasi.");
    }
    return this.io;
  }

  /** Emit ke satu room */
  public static emitToRoom(room: string, event: string, payload: any) {
    if (!this.io) return;
    this.io.to(room).emit(event, payload);
  }

  /** Emit ke satu user (semua device/tab miliknya) */
  public static emitToUser(userId: string, event: string, payload: any) {
    if (!this.io) return;
    this.io.to(`user_${userId}`).emit(event, payload);
  }

  /** Emit ke seluruh participant order */
  public static emitToOrder(orderId: string, event: string, payload: any) {
    if (!this.io) return;
    this.io.to(`order_${orderId}`).emit(event, payload);
  }

  /** Emit ke seluruh admin yang sedang terhubung (dashboard admin realtime) */
  public static emitToAdmins(event: string, payload: any) {
    if (!this.io) return;
    this.io.to("admins").emit(event, payload);
  }

  /** Emit ke seluruh driver yang sedang memantau pool lowongan (order baru masuk) */
  public static emitToDriversPool(event: string, payload: any) {
    if (!this.io) return;
    this.io.to("drivers_pool").emit(event, payload);
  }
}