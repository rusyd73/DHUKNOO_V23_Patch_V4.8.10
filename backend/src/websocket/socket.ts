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

      // PERBAIKAN: sebelumnya key Redis untuk cleanup "set offline saat
      // disconnect" (di bawah) hanya dibuat oleh event 'driver-register',
      // yang TIDAK PERNAH dipanggil oleh frontend manapun (driver online
      // status di-toggle lewat REST, bukan socket). Akibatnya driver yang
      // koneksinya putus (app crash, sinyal hilang, tab ditutup paksa)
      // TIDAK PERNAH otomatis di-set offline di database -- dispatch
      // engine akan terus menawarkan order ke driver "hantu" ini sampai
      // OFFER_TIMEOUT_SECONDS habis sebelum lanjut ke driver berikutnya,
      // salah satu penyebab order terasa lambat/tidak realtime. Sekarang
      // key registrasi dibuat langsung saat koneksi socket terbentuk.
      if (user.role === "DRIVER") {
        RedisService.setex(`${SOCKET_PREFIX}${user.id}`, 60 * 60 * 24 * 7, socket.id).catch((err) => {
          logger.error(`[SOCKET] Gagal mendaftarkan socket driver ${user.id} ke Redis: ${(err as Error).message}`);
        });
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
      // 🔥 [DIHAPUS] LEGACY DUPLICATE HANDLERS: driver-register,
      // driver-toggle-ready, publish-order, accept-order
      // ──────────────────────────────────────────────────────────────────
      // PERBAIKAN (poin #3 - stabilitas): blok event handler ini adalah
      // implementasi LAMA/DUPLIKAT dari alur order yang sekarang sudah
      // ditangani dengan benar lewat REST + service layer:
      //   - toggle online/auto-accept  -> DriverAPI (REST, driverProfile.isOnline)
      //   - publish/create order       -> OrderService.createOrder (REST)
      //   - accept order               -> OrderService.acceptOrder /
      //                                    DispatchService.acceptOffer /
      //                                    driver/routes/job.routes.ts (REST)
      // Frontend TIDAK PERNAH memanggil event socket ini (grep
      // "accept-order"/"driver-register"/"publish-order" di frontend/src
      // hanya menghasilkan definisi handler, tidak ada `socket.emit` yang
      // memicunya). Selama masih ada di sini, kode ini adalah jebakan:
      //   - Melewati semua pengecekan bisnis (verifikasi driver, minimum
      //     deposit, unconfirmed cash, dsb) yang sudah benar di REST.
      //   - Broadcast ke SEMUA client (`this.io.emit(...)`) alih-alih ke
      //     room yang relevan.
      //   - Nama room-nya salah (`to(orderId)` tanpa prefix "order_"),
      //     tidak konsisten dengan seluruh sistem room lain di file ini.
      // Kalau alur ini ternyata memang masih dibutuhkan (mis. untuk versi
      // Android/iOS native yang belum migrasi ke REST), jangan aktifkan
      // ulang blok ini apa adanya -- bangun ulang lewat pemanggilan
      // OrderService/DispatchService yang sama seperti REST, supaya semua
      // pengecekan bisnis & event realtime tetap konsisten satu jalur.

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