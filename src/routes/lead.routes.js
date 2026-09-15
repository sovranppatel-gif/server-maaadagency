import { Router } from "express";
import * as ctrl from "../controllers/lead.controller.js";
import { protect, authorize } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { idParam, leadSchemas } from "../validators/index.js";

const router = Router();

router.use(protect);

router.get("/", validate({ query: leadSchemas.list }), ctrl.listLeads);
router.get("/stats", ctrl.leadStats);
router.get("/:id", validate({ params: idParam }), ctrl.getLead);

router.post("/", authorize("ADMIN"), validate({ body: leadSchemas.create }), ctrl.createLead);
router.patch("/:id", authorize("ADMIN"), validate({ params: idParam, body: leadSchemas.update }), ctrl.updateLead);
router.post("/:id/assign", authorize("ADMIN"), validate({ params: idParam, body: leadSchemas.assign }), ctrl.assignLead);
router.patch("/:id/status", validate({ params: idParam, body: leadSchemas.status }), ctrl.updateLeadStatus);
router.delete("/:id", authorize("ADMIN"), validate({ params: idParam }), ctrl.deleteLead);

export default router;
