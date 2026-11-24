import { Router } from "express";
import * as ctrl from "../controllers/followUp.controller.js";
import { protect, authorize } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { followUpSchemas } from "../validators/index.js";

const router = Router();

router.use(protect);
router.get("/report", authorize("ADMIN"), ctrl.followUpReport);
router.get("/summary", ctrl.followUpSummary);
router.get("/", validate({ query: followUpSchemas.list }), ctrl.listFollowUps);

export default router;
