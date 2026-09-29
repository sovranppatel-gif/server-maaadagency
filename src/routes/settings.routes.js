import { Router } from "express";
import * as ctrl from "../controllers/settings.controller.js";
import { protect, authorize } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { settingsSchemas } from "../validators/index.js";

const router = Router();

// Settings are owner-level configuration.
router.use(protect, authorize("MASTER_ADMIN"));

router.get("/general", ctrl.getGeneralSettings);
router.patch("/general", validate({ body: settingsSchemas.general }), ctrl.updateGeneralSettings);

router.get("/whatsapp", ctrl.getWhatsAppSettings);
router.patch("/whatsapp", validate({ body: settingsSchemas.whatsapp }), ctrl.updateWhatsAppSettings);
router.post("/whatsapp/test", ctrl.testWhatsAppConnection);

router.get("/ai", ctrl.getAiSettings);
router.patch("/ai", validate({ body: settingsSchemas.ai }), ctrl.updateAiSettings);

export default router;
