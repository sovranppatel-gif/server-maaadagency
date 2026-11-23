import { Router } from "express";
import * as ctrl from "../controllers/employee.controller.js";
import { protect, authorize } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { employeeSchemas, idParam } from "../validators/index.js";

const router = Router();

router.use(protect);

router.get("/", validate({ query: employeeSchemas.list }), ctrl.listEmployees);
router.get("/stats", authorize("ADMIN"), ctrl.employeeStats);
router.get("/:id/access", authorize("MASTER_ADMIN"), validate({ params: idParam }), ctrl.getEmployeeAccess);
router.get("/:id", validate({ params: idParam }), ctrl.getEmployee);

router.post("/", authorize("ADMIN"), validate({ body: employeeSchemas.create }), ctrl.createEmployee);
router.post("/:id/access", authorize("MASTER_ADMIN"), validate({ params: idParam }), ctrl.createEmployeeLogin);
router.post("/:id/access/invitation", authorize("MASTER_ADMIN"), validate({ params: idParam }), ctrl.resendEmployeeInvitation);
router.post("/:id/access/reset", authorize("MASTER_ADMIN"), validate({ params: idParam }), ctrl.initiateEmployeePasswordReset);
router.patch("/:id/access", authorize("MASTER_ADMIN"), validate({ params: idParam, body: employeeSchemas.access }), ctrl.updateEmployeeAccess);
router.patch("/:id", authorize("ADMIN"), validate({ params: idParam, body: employeeSchemas.update }), ctrl.updateEmployee);
router.post("/:id/deactivate", authorize("ADMIN"), validate({ params: idParam }), ctrl.deactivateEmployee);
router.post("/:id/recalculate", authorize("ADMIN"), validate({ params: idParam }), ctrl.recalculateEmployee);

export default router;
