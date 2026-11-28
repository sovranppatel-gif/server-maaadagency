import { Router } from "express";
import * as ctrl from "../controllers/visit.controller.js";
import { protect, authorize } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { idParam, visitSchemas } from "../validators/index.js";

const router = Router();

router.use(protect);

router.get("/", validate({ query: visitSchemas.list }), ctrl.listVisits);
router.get("/stats", ctrl.visitStats);
router.get("/report", authorize("ADMIN"), validate({ query: visitSchemas.report }), ctrl.visitReport);
router.get("/:id", validate({ params: idParam }), ctrl.getVisit);

router.patch("/:id/reschedule", validate({ params: idParam, body: visitSchemas.reschedule }), ctrl.rescheduleVisit);
router.patch("/:id/complete", validate({ params: idParam, body: visitSchemas.complete }), ctrl.completeVisit);
router.patch("/:id/cancel", validate({ params: idParam, body: visitSchemas.cancel }), ctrl.cancelVisit);

export default router;
