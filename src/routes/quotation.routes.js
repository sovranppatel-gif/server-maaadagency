import { Router } from "express";
import * as ctrl from "../controllers/quotation.controller.js";
import { authorize, protect } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { idParam, quotationSchemas } from "../validators/index.js";

const router = Router();

router.use(protect, authorize("ADMIN", "EMPLOYEE"));
router.get("/summary", ctrl.quotationSummary);
router.get("/catalog", ctrl.quotationCatalog);
router.get("/", validate({ query: quotationSchemas.list }), ctrl.listQuotations);
router.post("/", validate({ body: quotationSchemas.create }), ctrl.createQuotation);
router.get("/:id/pdf", validate({ params: idParam, query: quotationSchemas.pdf }), ctrl.getQuotationPdf);
router.get("/:id", validate({ params: idParam }), ctrl.getQuotation);
router.patch("/:id", validate({ params: idParam, body: quotationSchemas.draft }), ctrl.updateQuotationDraft);
router.post("/:id/submit", validate({ params: idParam, body: quotationSchemas.submit }), ctrl.submitQuotation);
router.post("/:id/approve", validate({ params: idParam, body: quotationSchemas.approve }), ctrl.approveQuotation);
router.post("/:id/reject", validate({ params: idParam, body: quotationSchemas.reject }), ctrl.rejectQuotation);
router.post("/:id/request-revision", validate({ params: idParam, body: quotationSchemas.revisionRequest }), ctrl.requestQuotationRevision);
router.post("/:id/sent", validate({ params: idParam, body: quotationSchemas.send }), ctrl.recordQuotationSent);
router.post("/:id/customer-decision", validate({ params: idParam, body: quotationSchemas.customerDecision }), ctrl.recordCustomerDecision);
router.post("/:id/expire", validate({ params: idParam, body: quotationSchemas.expire }), ctrl.expireQuotation);
router.post("/:id/revise", validate({ params: idParam, body: quotationSchemas.revision }), ctrl.startQuotationRevision);

export default router;
