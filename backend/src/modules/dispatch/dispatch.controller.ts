import { Response, NextFunction } from "express";
import { AuthenticatedRequest } from "../../core/middleware/auth.middleware";
import { DispatchService } from "./dispatch.service";
import { prisma } from "../../config/prisma";
import { AppError, NotFoundError, ForbiddenError } from "../../core/errors/AppError";

export class DispatchController {
  private dispatchService = new DispatchService();

  /*
  |--------------------------------------------------------------------------
  | (Re-)Start Dispatch — ADMIN saja
  |--------------------------------------------------------------------------
  |
  | KEAMANAN: sebelumnya endpoint ini menerima objek `order` MENTAH dari body
  | request (`req.body.order`) tanpa autentikasi sama sekali — siapa pun bisa
  | mengarang order palsu (customerId/price/dsb bebas) dan memicu penawaran ke
  | driver asli. Sekarang: WAJIB login sebagai ADMIN, dan order diambil dari
  | database berdasarkan `orderId` — bukan dipercaya dari client.
  |
  | Dipakai untuk memicu ULANG dispatch manual (mis. order PENDING lama yang
  | tidak kunjung dapat driver). Order baru sudah otomatis di-dispatch oleh
  | OrderService.createOrder — endpoint ini bukan jalur utama.
  */
  dispatch = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { orderId } = req.body;
      if (!orderId) {
        throw new AppError("orderId wajib diisi", 400);
      }

      const order = await prisma.order.findUnique({ where: { id: orderId } });
      if (!order) {
        throw new NotFoundError("Order tidak ditemukan!");
      }
      if (order.status !== "PENDING") {
        throw new AppError("Hanya order berstatus PENDING yang bisa di-dispatch ulang.", 409);
      }

      const result = await this.dispatchService.dispatch({ order });
      return res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  };

  /*
  |--------------------------------------------------------------------------
  | Driver Accept Offer
  |--------------------------------------------------------------------------
  |
  | KEAMANAN: sebelumnya `driverId` diambil mentah dari body request tanpa
  | autentikasi — siapa pun bisa menyuruh driver LAIN "menerima" sebuah order.
  | Sekarang: WAJIB login sebagai DRIVER, dan driverId SELALU diturunkan dari
  | akun yang sedang login (req.user.id) — parameter driverId dari body diabaikan.
  */
  accept = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const userId = req.user?.id;
      const { orderId } = req.params;

      if (!userId) {
        throw new AppError("Tidak terautentikasi", 401);
      }
      if (!orderId) {
        throw new AppError("orderId wajib diisi", 400);
      }

      const driverProfile = await prisma.driverProfile.findUnique({ where: { userId } });
      if (!driverProfile) {
        throw new ForbiddenError("Profil driver tidak ditemukan!");
      }

      const result = await this.dispatchService.acceptOffer(orderId, driverProfile.id);
      return res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  };

  /*
  |--------------------------------------------------------------------------
  | Dispatch Status
  |--------------------------------------------------------------------------
  | Dibaca oleh customer/driver yang terlibat, atau admin.
  |
  | 🆕 FIX P1 "Dispatch status authorization" (audit): SEBELUMNYA endpoint
  | ini HANYA dilindungi authenticateToken di route (dispatch.route.ts) --
  | siapa pun yang sudah login (role apa pun, termasuk customer lain yang
  | SAMA SEKALI TIDAK TERLIBAT di order ini) bisa membaca status dispatch
  | order MANA PUN cukup dengan menebak/mengiterasi orderId. Komentar di
  | atas endpoint ini SUDAH menyatakan niatnya ("customer/driver yang
  | terlibat, atau admin") tapi implementasinya tidak pernah benar-benar
  | menegakkan itu -- authentication (siapa Anda) saja tidak cukup, harus
  | ada authorization (apakah Anda berhak lihat order INI).
  |
  | Sekarang order diambil dulu dari DB, lalu requester HARUS salah satu
  | dari: customer pemilik order, driver yang ditugaskan (kalau sudah
  | ada), atau ADMIN -- sama seperti pola yang sudah dipakai di
  | OrderService.updateStatus() untuk endpoint order lainnya.
  */
  status = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { orderId } = req.params;
      const userId = req.user?.id;
      const role = req.user?.role;

      if (!userId) {
        throw new AppError("Tidak terautentikasi", 401);
      }
      if (!orderId) {
        throw new AppError("orderId wajib diisi", 400);
      }

      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { customer: true, driver: true },
      });
      if (!order) {
        throw new NotFoundError("Order tidak ditemukan!");
      }

      const isOwningCustomer = order.customer?.userId === userId;
      const isAssignedDriver = order.driver?.userId === userId;
      const isAdmin = role === "ADMIN";

      if (!isOwningCustomer && !isAssignedDriver && !isAdmin) {
        throw new ForbiddenError("Anda tidak berhak melihat status dispatch order ini!");
      }

      // 🆕 FIX BUG BERSEBELAHAN: getStatus() adalah method async (return
      // Promise) tapi sebelumnya dipanggil TANPA await -- res.json()
      // akan men-serialize objek Promise itu sendiri (jadi `{}` kosong
      // di response), bukan data status yang sebenarnya.
      const result = await this.dispatchService.getStatus(orderId);
      return res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  };
}
