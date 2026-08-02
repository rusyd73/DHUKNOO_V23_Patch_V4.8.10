import { Router } from "express";
import { DispatchController } from "./dispatch.controller";
import { authenticateToken, authorizeRoles } from "../../core/middleware/auth.middleware";

const router = Router();
const controller = new DispatchController();

// Semua endpoint dispatch WAJIB login — sebelumnya tidak ada middleware auth
// sama sekali di sini (lubang keamanan besar: siapa pun bisa memicu dispatch
// atau "menerima" order atas nama driver manapun).

// (Re-)Start dispatch manual — ADMIN saja.
router.post("/start", authenticateToken as any, authorizeRoles("ADMIN") as any, controller.dispatch);

// Driver menerima offer — DRIVER saja, driverId diturunkan dari token, bukan body.
router.post("/:orderId/accept", authenticateToken as any, authorizeRoles("DRIVER") as any, controller.accept);

// Lihat status dispatch — siapa pun yang sudah login (customer/driver/admin terlibat).
router.get("/:orderId/status", authenticateToken as any, controller.status);

export default router;
