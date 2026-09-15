import { Router } from "express";
import * as ctrl from "../controllers/analytics.controller.js";
import { protect, authorize } from "../middleware/auth.js";

const router = Router();

router.use(protect, authorize("ADMIN"));

router.get("/dashboard", ctrl.dashboardSummary);
router.get("/whatsapp", ctrl.whatsappAnalytics);
router.get("/", ctrl.analytics);

export default router;
