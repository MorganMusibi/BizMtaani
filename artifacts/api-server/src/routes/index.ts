import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import uploadRouter from "./upload.js";
import notificationsRouter from "./notifications.js";
import mpesaRouter from "./mpesa.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(uploadRouter);
router.use(notificationsRouter);
router.use(mpesaRouter);

export default router;
