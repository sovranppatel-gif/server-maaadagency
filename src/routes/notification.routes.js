import { Router } from "express";
import * as ctrl from "../controllers/notification.controller.js";
import { protect } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { idParam, notificationSchemas } from "../validators/index.js";

const router = Router();

router.use(protect);

router.get("/", validate({ query: notificationSchemas.list }), ctrl.listNotifications);
router.get("/unread-count", ctrl.unreadCount);
router.patch("/read-all", ctrl.markAllRead);
router.patch("/:id/read", validate({ params: idParam }), ctrl.markRead);
router.delete("/:id", validate({ params: idParam }), ctrl.deleteNotification);

export default router;
