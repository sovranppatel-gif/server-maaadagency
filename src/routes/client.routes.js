import { Router } from "express";
import * as ctrl from "../controllers/client.controller.js";
import { protect, authorize } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { clientSchemas, idParam } from "../validators/index.js";

const router = Router();

router.use(protect);

router.get("/", validate({ query: clientSchemas.list }), ctrl.listClients);
router.get("/:id", validate({ params: idParam }), ctrl.getClient);

router.post("/", authorize("ADMIN"), validate({ body: clientSchemas.create }), ctrl.createClient);
router.patch("/:id", authorize("ADMIN"), validate({ params: idParam, body: clientSchemas.update }), ctrl.updateClient);
router.post("/:id/recalculate", authorize("ADMIN"), validate({ params: idParam }), ctrl.recalculateClient);

export default router;
