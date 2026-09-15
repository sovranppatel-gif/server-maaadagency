import { Router } from "express";
import * as ctrl from "../controllers/auth.controller.js";
import { protect, authorize } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { authLimiter } from "../middleware/rateLimit.js";
import { authSchemas } from "../validators/index.js";

const router = Router();

router.post("/login", authLimiter, validate({ body: authSchemas.login }), ctrl.login);
router.post("/refresh", authLimiter, ctrl.refresh);
router.post("/logout", ctrl.logout);

router.get("/me", protect, ctrl.me);
router.post("/change-password", protect, validate({ body: authSchemas.changePassword }), ctrl.changePassword);

// Only the owner account may provision new logins.
router.post("/register", protect, authorize("MASTER_ADMIN"), validate({ body: authSchemas.register }), ctrl.register);

export default router;
