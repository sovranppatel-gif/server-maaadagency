import { Router } from "express";
import * as ctrl from "../controllers/project.controller.js";
import { protect, authorize } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { idParam, projectSchemas } from "../validators/index.js";

const router = Router();

router.use(protect);

router.get("/", validate({ query: projectSchemas.list }), ctrl.listProjects);
router.get("/:id", validate({ params: idParam }), ctrl.getProject);

router.post("/", authorize("ADMIN"), validate({ body: projectSchemas.create }), ctrl.createProject);
router.patch("/:id", authorize("ADMIN"), validate({ params: idParam, body: projectSchemas.update }), ctrl.updateProject);
router.post("/:id/tasks", validate({ params: idParam, body: projectSchemas.task }), ctrl.addTask);
router.patch("/:id/tasks/:taskId", validate({ body: projectSchemas.toggleTask }), ctrl.toggleTask);
router.post("/:id/comments", validate({ params: idParam, body: projectSchemas.comment }), ctrl.addComment);
router.delete("/:id", authorize("ADMIN"), validate({ params: idParam }), ctrl.deleteProject);

export default router;
