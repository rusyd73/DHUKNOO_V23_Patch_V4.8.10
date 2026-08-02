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
  */
  status = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { orderId } = req.params;
      if (!orderId) {
        throw new AppError("orderId wajib diisi", 400);
      }

      const result = this.dispatchService.getStatus(orderId);
      return res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  };
}
