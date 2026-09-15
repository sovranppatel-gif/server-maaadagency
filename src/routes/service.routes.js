import { Router } from "express";
import * as ctrl from "../controllers/service.controller.js";
import { protect, authorize } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { idParam, serviceSchemas } from "../validators/index.js";

const router = Router();

router.use(protect);

router.get("/", ctrl.listServices);
router.post("/", authorize("ADMIN"), validate({ body: serviceSchemas.create }), ctrl.createService);
router.patch("/:id", authorize("ADMIN"), validate({ params: idParam, body: serviceSchemas.update }), ctrl.updateService);
router.post("/:id/toggle", authorize("ADMIN"), validate({ params: idParam }), ctrl.toggleService);
router.delete("/:id", authorize("ADMIN"), validate({ params: idParam }), ctrl.deleteService);

export default router;
