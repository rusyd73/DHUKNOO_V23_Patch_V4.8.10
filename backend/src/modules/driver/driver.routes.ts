import { Router } from "express";
import { profileRouter } from "./routes/profile.routes";
import { jobRouter } from "./routes/job.routes";
import { documentRouter } from "./routes/document.routes";

const router = Router();

router.use(profileRouter);
router.use(jobRouter);
router.use(documentRouter);


export const driverRouter = router;