import { Router } from "express";
import * as ctrl from "../controllers/work.controller.js";
import { protect, authorize } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { idParam, workSchemas } from "../validators/index.js";

const router = Router();

router.use(protect);

router.get("/", validate({ query: workSchemas.list }), ctrl.listWorks);
router.get("/stats", ctrl.workStats);
router.get("/:id", validate({ params: idParam }), ctrl.getWork);

router.post("/", authorize("ADMIN"), validate({ body: workSchemas.create }), ctrl.createWork);
router.patch("/:id", authorize("ADMIN"), validate({ params: idParam, body: workSchemas.update }), ctrl.updateWork);
router.post("/:id/assign", authorize("ADMIN"), validate({ params: idParam, body: workSchemas.assign }), ctrl.assignWork);

// Employees drive progress and submission on their own work.
router.patch("/:id/progress", validate({ params: idParam, body: workSchemas.progress }), ctrl.updateProgress);
router.post("/:id/submit", validate({ params: idParam, body: workSchemas.submit }), ctrl.submitWork);

// Review decisions are admin-only.
router.post("/:id/approve", authorize("ADMIN"), validate({ params: idParam }), ctrl.approveWork);
router.post("/:id/request-changes", authorize("ADMIN"), validate({ params: idParam, body: workSchemas.revision }), ctrl.requestChanges);
router.post("/:id/complete", authorize("ADMIN"), validate({ params: idParam }), ctrl.completeWork);
router.delete("/:id", authorize("ADMIN"), validate({ params: idParam }), ctrl.deleteWork);

export default router;
