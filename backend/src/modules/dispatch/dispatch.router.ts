import { Router } from "express";
import { DispatchController } from "./dispatch.controller";
import { authenticateToken, authorizeRoles } from "../../core/middleware/auth.middleware";
import { validateBody } from "../../core/middleware/validation.middleware";
import { z } from "zod";
import { OrderStatus } from "@prisma/client";

const router = Router();
const controller = new DispatchController();

const updateStatusSchema = z.object({
  status: z.nativeEnum(OrderStatus),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

/*
|--------------------------------------------------------------------------
| Fase 1: Matching / Dispatch Engine (Sebelum Deal)
|--------------------------------------------------------------------------
*/
// Jalur statis diposisikan paling atas untuk mencegah route collision
router.post("/start", authenticateToken as any, controller.dispatch.bind(controller) as any);
router.post("/:orderId/accept", authenticateToken as any, authorizeRoles("DRIVER") as any, controller.accept.bind(controller) as any);
router.get("/:orderId/status", authenticateToken as any, controller.status.bind(controller) as any);

/*
|--------------------------------------------------------------------------
| Fase 2: On-Trip Lifecycle Management (Setelah Deal)
|--------------------------------------------------------------------------
*/

export default router;
