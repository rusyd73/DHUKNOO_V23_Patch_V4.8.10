import { Server as HttpServer } from "http";
import { Server, Socket } from "socket.io";
import jwt from "jsonwebtoken";
import { logger } from "../config/logger";
import { ENV } from "../config/env";
import { prisma } from "../config/prisma";
import { RedisService } from "../config/redis";

type SocketRole = "CUSTOMER" | "DRIVER" | "ADMIN" | "MERCHANT";

interface SocketUser {
  id: string;
  email: string;
  role: SocketRole;
}

interface SocketData {
  user: SocketUser;
  userId?: string;
  role?: string;
}

type AppServer = Server<any, any, any, SocketData>;
type AppSocket = Socket<any, any, any, SocketData>;

const LOCATION_UPDATE_MIN_INTERVAL_MS = 2000;
const CHAT_MESSAGE_MIN_INTERVAL_MS = 400;
const SOCKET_PREFIX = 'socket:driver:';
const DRIVER_SOCKETS_SET = 'driver:sockets:';
const DRIVER_LOCATION_PREFIX = 'driver:location:';
const ROOM_PREFIX = 'room:';

export class SocketService {
  private static io: AppServer | null = null;
  private static lastLocationEmitAt = new Map<string, number>();
  private static lastChatEmitAt = new Map<string, number>();

  public static init(server: HttpServer): AppServer {
    // 🆕 FIX "WebSocket security": konsisten dengan fix CORS Express di
    // app.ts -- sejak env.ts sekarang hard-fail di production kalau
    // ALLOWED_ORIGINS kosong, cabang '*' di bawah ini SECARA PRAKTIK
    // hanya bisa kejadian di development (production sudah crash duluan
    // sebelum sampai sini). Tetap dipertahankan sebagai defense-in-depth
    // + biar dev tidak perlu set env dulu, tapi didokumentasikan bahwa
    // kombinasi origin:'*' + credentials:true sebenarnya juga tidak
    // valid untuk Socket.IO (browser akan menolak handshake polling
    // transport-nya kalau benar-benar dipakai lintas origin dengan
    // cookie) -- untuk dev lokal biasanya tidak masalah karena same-origin.
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

    // ── 2. Connection handler ────────────────────────────────────────────
    this.io.on("connection", (socket: AppSocket) => {
      const user = socket.data.user;
      logger.info(`Socket client connected: ${socket.id} (user=${user.id}, role=${user.role})`);

      // ✅ SET socket.data untuk disconnect
      socket.data.userId = user.id;
      socket.data.role = user.role;

      // Room pribadi otomatis
      socket.join(`user_${user.id}`);
      if (user.role === "ADMIN") {
        socket.join("admins");
      }

      // ✅ REGISTER MULTIPLE SOCKETS PAKAI REDIS SET (untuk driver)
      if (user.role === "DRIVER") {
        const setKey = `${DRIVER_SOCKETS_SET}${user.id}`;
        RedisService.sadd(setKey, socket.id).catch((err) => {
          logger.error(`[SOCKET] Gagal menambahkan socket driver ${user.id} ke Redis Set: ${(err as Error).message}`);
        });
        RedisService.expire(setKey, 60 * 60 * 24 * 7).catch((err) => {
          logger.error(`[SOCKET] Gagal set expire untuk driver ${user.id}: ${(err as Error).message}`);
        });

        // SIMPAN juga individual key (untuk backward compatibility)
        RedisService.setex(`${SOCKET_PREFIX}${user.id}`, 60 * 60 * 24 * 7, socket.id).catch((err) => {
          logger.error(`[SOCKET] Gagal mendaftarkan socket driver ${user.id} ke Redis: ${(err as Error).message}`);
        });

        logger.info(`[SOCKET] Driver ${user.id} registered (total sockets: ${RedisService.scard(setKey)})`);
      }

      // ──────────────────────────────────────────────────────────────────
      // 🔥 EVENT HANDLER
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
       * 🔥 In-App Call events (VoIP) — relay ke room order
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
      // 🔥 DISCONNECT - Cleanup (TANPA KEYS * + MULTI DEVICE SUPPORT)
      // ──────────────────────────────────────────────────────────────────
      socket.on("disconnect", async () => {
        this.lastLocationEmitAt.delete(socket.id);
        this.lastChatEmitAt.delete(socket.id);
        logger.info(`Socket disconnected : ${socket.id}`);

        try {
          const userId = socket.data?.userId;
          if (!userId) {
            logger.warn(`[SOCKET] No userId found for socket ${socket.id}`);
            return;
          }

          const role = socket.data?.role;

          // ✅ DRIVER: Hapus dari Redis Set (multi-device support)
          if (role === 'DRIVER') {
            const setKey = `${DRIVER_SOCKETS_SET}${userId}`;
            await RedisService.srem(setKey, socket.id);

            // Cek sisa socket aktif
            const activeSockets = await RedisService.smembers(setKey);
            const activeCount = activeSockets.length;

            logger.info(`[SOCKET] Driver ${userId} remaining active sockets: ${activeCount}`);

            // 🔒 Driver OFFLINE hanya jika TIDAK ADA socket aktif
            if (activeCount === 0) {
              // Hapus individual key
              await RedisService.del(`${SOCKET_PREFIX}${userId}`);

              // Hapus lokasi
              await RedisService.del(`${DRIVER_LOCATION_PREFIX}${userId}`);

              // Update status offline di database
              await prisma.driverProfile.update({
                where: { userId: userId },
                data: { isOnline: false }
              });

              logger.info(`🔴 Driver ${userId} disconnected (all ${activeCount} sockets closed), set offline`);
            } else {
              // Masih ada socket aktif, tetap online
              logger.info(`🟢 Driver ${userId} still online (${activeCount} active sockets)`);
            }
          } else {
            // ✅ NON-DRIVER: Langsung hapus key
            await RedisService.del(`${SOCKET_PREFIX}${userId}`);
          }

          // Hapus room key
          await RedisService.del(`${ROOM_PREFIX}${userId}`);

        } catch (error) {
          logger.error("[SOCKET] Disconnect cleanup error:", error);
        }
      });
    });

    logger.info("Socket.IO initialized (auth + room authorization enabled).");
    return this.io;
  }

  // ──────────────────────────────────────────────────────────────────
  // 🔥 PRIVATE STATIC METHODS
  // ──────────────────────────────────────────────────────────────────

  private static async canJoinRoom(user: SocketUser, roomId: string): Promise<boolean> {
    if (user.role === "ADMIN") return true;

    // 🆕 FIX "WebSocket security" -- KEBOCORAN PRIVASI KRITIS:
    // sebelumnya kedua room ini bisa di-join SIAPA SAJA yang login
    // (customer, merchant, bahkan driver lain yang tidak berkepentingan),
    // tanpa pengecekan role sama sekali:
    // - "map_updates" menyiarkan lokasi GPS REAL-TIME SEMUA driver
    //   platform (lihat driver_location_update handler) -- customer/
    //   merchant manapun bisa join lalu memantau/menguntit pergerakan
    //   semua driver, bukan cuma driver yang sedang mengantar order
    //   mereka. Risiko keamanan fisik nyata buat driver.
    // - "drivers_pool" menyiarkan detail SETIAP order baru
    //   (pickupAddress, dropoffAddress, price -- lihat
    //   emitToDriversPool('new_order_available', ...)) ke siapa pun di
    //   room ini -- customer/merchant manapun bisa join lalu memanen
    //   alamat rumah & harga order customer LAIN secara real-time.
    // Sekarang keduanya HANYA untuk role DRIVER (yang memang butuh info
    // ini untuk bekerja) atau ADMIN (sudah return true di baris atas).
    if (roomId === "map_updates" || roomId === "drivers_pool") {
      return user.role === "DRIVER";
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

  // ──────────────────────────────────────────────────────────────────
  // 🔥 PUBLIC STATIC METHODS
  // ──────────────────────────────────────────────────────────────────

  public static getIO(): AppServer {
    if (!this.io) {
      throw new Error("Socket.IO belum diinisialisasi.");
    }
    return this.io;
  }

  public static emitToRoom(room: string, event: string, payload: any) {
    if (!this.io) return;
    this.io.to(room).emit(event, payload);
  }

  public static emitToUser(userId: string, event: string, payload: any) {
    if (!this.io) return;
    this.io.to(`user_${userId}`).emit(event, payload);
  }

  public static emitToOrder(orderId: string, event: string, payload: any) {
    if (!this.io) return;
    this.io.to(`order_${orderId}`).emit(event, payload);
  }

  public static emitToAdmins(event: string, payload: any) {
    if (!this.io) return;
    this.io.to("admins").emit(event, payload);
  }

  public static emitToDriversPool(event: string, payload: any) {
    if (!this.io) return;
    this.io.to("drivers_pool").emit(event, payload);
  }

  // ============================================================
  // 🔒 HELPER: CEK DRIVER ONLINE (PAKAI REDIS SET)
  // ============================================================
  public static async isDriverOnline(driverId: string): Promise<boolean> {
    try {
      const setKey = `${DRIVER_SOCKETS_SET}${driverId}`;
      const count = await RedisService.scard(setKey);
      return count > 0;
    } catch {
      const key = `${SOCKET_PREFIX}${driverId}`;
      const socketId = await RedisService.get(key);
      return !!socketId;
    }
  }

  // ============================================================
  // 🔒 HELPER: GET DRIVER ACTIVE SOCKETS
  // ============================================================
  public static async getDriverSockets(driverId: string): Promise<string[]> {
    const setKey = `${DRIVER_SOCKETS_SET}${driverId}`;
    return RedisService.smembers(setKey);
  }
}