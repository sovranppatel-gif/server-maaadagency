import { Router } from "express";
import * as ctrl from "../controllers/lead.controller.js";
import { protect, authorize } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { followUpSchemas, idParam, leadSchemas, paginationQuery, visitSchemas } from "../validators/index.js";
import * as followUpCtrl from "../controllers/followUp.controller.js";
import * as visitCtrl from "../controllers/visit.controller.js";
import * as importExportCtrl from "../controllers/leadImportExport.controller.js";
import { spreadsheetUpload } from "../middleware/spreadsheetUpload.js";

const router = Router();

router.use(protect);

router.get("/", validate({ query: leadSchemas.list }), ctrl.listLeads);
router.get("/stats", ctrl.leadStats);
router.get("/export", validate({ query: leadSchemas.exportQuery }), importExportCtrl.exportLeads);
router.post("/import/preview", authorize("ADMIN"), spreadsheetUpload.single("file"), importExportCtrl.previewLeadImport);
router.post("/import/confirm", authorize("ADMIN"), validate({ body: leadSchemas.confirmImport }), importExportCtrl.confirmLeadImport);
router.get("/import/jobs", authorize("ADMIN"), validate({ query: paginationQuery }), importExportCtrl.listImportJobs);
router.get("/import/jobs/:id", authorize("ADMIN"), validate({ params: idParam }), importExportCtrl.getImportJob);

router.get("/:id", validate({ params: idParam }), ctrl.getLead);
router.get("/:id/follow-ups", validate({ params: idParam, query: followUpSchemas.list }), followUpCtrl.listLeadFollowUps);
router.get("/:leadId/visits", visitCtrl.listLeadVisits);

router.post("/", authorize("ADMIN"), validate({ body: leadSchemas.create }), ctrl.createLead);
router.post("/:id/follow-ups", validate({ params: idParam, body: leadSchemas.followUp }), followUpCtrl.createLeadFollowUp);
router.post("/:leadId/visits", validate({ body: visitSchemas.create }), visitCtrl.createLeadVisit);
router.post("/:id/follow-ups/authorize-more", authorize("ADMIN"), validate({ params: idParam, body: leadSchemas.followUpAuthorization }), followUpCtrl.authorizeMoreFollowUps);
router.post("/:id/follow-ups/close", authorize("ADMIN"), validate({ params: idParam }), followUpCtrl.closeLeadFollowUps);
router.patch("/:id", authorize("ADMIN"), validate({ params: idParam, body: leadSchemas.update }), ctrl.updateLead);
router.post("/:id/assign", authorize("ADMIN"), validate({ params: idParam, body: leadSchemas.assign }), ctrl.assignLead);
router.patch("/:id/status", validate({ params: idParam, body: leadSchemas.status }), ctrl.updateLeadStatus);
router.patch("/:id/quality", validate({ params: idParam, body: leadSchemas.quality }), ctrl.updateLeadQuality);
router.delete("/:id", authorize("ADMIN"), validate({ params: idParam }), ctrl.deleteLead);

export default router;
