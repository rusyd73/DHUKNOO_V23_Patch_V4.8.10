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
import { z } from "zod";

const router = Router();

/*
|--------------------------------------------------------------------------
| Validation Schema
|--------------------------------------------------------------------------
*/

const statusToggleSchema = z.object({
  isOnline: z.boolean(),
});

const autoAcceptToggleSchema = z.object({
  autoAcceptEnabled: z.boolean(),
});

/*
|--------------------------------------------------------------------------
| GET /api/driver/me
|--------------------------------------------------------------------------
*/

router.get(
  "/me",
  authenticateToken as any,
  authorizeRoles("DRIVER") as any,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({
          error: "Tidak terautentikasi",
        });
      }

      const user = await prisma.user.findUnique({
        where: {
          id: userId,
        },
        include: {
          driverProfile: true,
          wallet: {
            include: {
              transactions: {
                orderBy: {
                  createdAt: "desc",
                },
                take: 10,
              },
            },
          },
        },
      });

      if (!user || !user.driverProfile) {
        return res.status(404).json({
          error: "Profil driver tidak ditemukan!",
        });
      }

      return res.status(200).json({
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        profile: user.driverProfile,
        wallet: user.wallet,
      });

    } catch (err) {

      console.error(err);

      return res.status(500).json({
        error: "Internal Server Error",
      });

    }
  }
);

/*
|--------------------------------------------------------------------------
| POST & PATCH /api/driver/status
|--------------------------------------------------------------------------
*/

const toggleStatusHandler = async (req: AuthenticatedRequest, res: Response) => {
    try {

      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({
          error: "Tidak terautentikasi",
        });
      }

      const { isOnline } = req.body;

      const driverProfile = await prisma.driverProfile.findUnique({
        where: {
          userId,
        },
      });

      if (!driverProfile) {
        return res.status(404).json({
          error: "Profil driver tidak ditemukan!",
        });
      }

      if (!driverProfile.isVerified) {
        return res.status(403).json({
          error:
            "Akun kemitraan Anda belum diverifikasi oleh Otoritas Pusat DHUKNOO!",
        });
      }

      if (isOnline) {
        const wallet = await prisma.wallet.findUnique({ where: { userId } });
        const balance = Number(wallet?.balance || 0);
        if (balance < 5000) {
          return res.status(400).json({
            error:
              "Gagal Online! Saldo dompet deposit Anda kurang dari batas minimal Rp 5.000 (saldo saat ini: Rp " +
              balance.toLocaleString("id-ID") +
              "). Silakan top-up saldo terlebih dahulu.",
          });
        }
      }

      const updatedProfile = await prisma.driverProfile.update({
        where: {
          id: driverProfile.id,
        },
        data: {
          isOnline,
        },
      });

      await AuditLogger.log(
        userId,
        "DRIVER_STATUS_CHANGE",
        `Mengubah status online menjadi: ${isOnline}`
      );

      /*
      |--------------------------------------------------------------------------
      | Broadcast Realtime
      |--------------------------------------------------------------------------
      */

      SocketService.emitToAdmins(
        "driver_status_changed",
        {
          driverId: driverProfile.id,
          isOnline,
        }
      );

      if (isOnline) {
        SocketService.emitToRoom(
          "drivers_pool",
          "driver_joined",
          {
            driverId: driverProfile.id,
          }
        );
        // Driver yang baru online harus melakukan discovery dari database,
        // bukan hanya menunggu event order yang dibuat sesudah ia online.
        SocketService.emitToUser(userId, "jobs_refresh_required", {
          reason: "DRIVER_WENT_ONLINE",
        });
      }

      return res.status(200).json({
        message:
          `Status kerja Anda sekarang ${
            isOnline ? "ONLINE" : "OFFLINE"
          }!`,
        profile: updatedProfile,
      });

    } catch (err) {

      console.error(err);

      return res.status(500).json({
        error: "Internal Server Error",
      });

    }
  };

router.post(
  "/status",
  authenticateToken as any,
  authorizeRoles("DRIVER") as any,
  validateBody(statusToggleSchema),
  toggleStatusHandler as any
);

router.patch(
  "/status",
  authenticateToken as any,
  authorizeRoles("DRIVER") as any,
  validateBody(statusToggleSchema),
  toggleStatusHandler as any
);

/*
|--------------------------------------------------------------------------
| PATCH /api/driver/auto-accept
|--------------------------------------------------------------------------
| BARU: opsi (default OFF) supaya order yang ditawarkan Dispatch Engine ke
| driver ini langsung diterima otomatis tanpa perlu tap manual. Driver yang
| TIDAK mengaktifkan ini tetap memakai alur manual seperti sebelumnya — lihat
| DispatchService.offerNextDriver().
*/
router.patch(
  "/auto-accept",
  authenticateToken as any,
  authorizeRoles("DRIVER") as any,
  validateBody(autoAcceptToggleSchema),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({ error: "Tidak terautentikasi" });
      }

      const { autoAcceptEnabled } = req.body;

      const driverProfile = await prisma.driverProfile.findUnique({ where: { userId } });
      if (!driverProfile) {
        return res.status(404).json({ error: "Profil driver tidak ditemukan!" });
      }

      const updated = await prisma.driverProfile.update({
        where: { userId },
        data: { autoAcceptEnabled },
      });

      await AuditLogger.log(
        userId,
        "DRIVER_TOGGLE_AUTO_ACCEPT",
        `Auto-accept order diubah menjadi: ${autoAcceptEnabled}`
      );

      return res.status(200).json({
        message: autoAcceptEnabled
          ? "Auto-accept diaktifkan — order yang ditawarkan ke Anda akan langsung diterima otomatis."
          : "Auto-accept dimatikan — Anda kembali menerima order secara manual.",
        profile: updated,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || "Gagal mengubah pengaturan auto-accept." });
    }
  }
);

export { router as profileRouter };
