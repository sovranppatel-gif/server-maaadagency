import { Router } from "express";
import mongoose from "mongoose";

import authRoutes from "./auth.routes.js";
import leadRoutes from "./lead.routes.js";
import workRoutes from "./work.routes.js";
import employeeRoutes from "./employee.routes.js";
import clientRoutes from "./client.routes.js";
import projectRoutes from "./project.routes.js";
import serviceRoutes from "./service.routes.js";
import notificationRoutes from "./notification.routes.js";
import fileRoutes from "./file.routes.js";
import whatsappRoutes from "./whatsapp.routes.js";
import analyticsRoutes from "./analytics.routes.js";
import settingsRoutes from "./settings.routes.js";

const router = Router();

const DB_STATES = ["disconnected", "connected", "connecting", "disconnecting"];

/** Liveness/readiness probe for load balancers and uptime monitoring. */
router.get("/health", (_req, res) => {
  const dbState = DB_STATES[mongoose.connection.readyState] ?? "unknown";
  const healthy = dbState === "connected";
  res.status(healthy ? 200 : 503).json({
    success: healthy,
    data: {
      status: healthy ? "ok" : "degraded",
      database: dbState,
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    },
  });
});

router.use("/auth", authRoutes);
router.use("/leads", leadRoutes);
router.use("/works", workRoutes);
router.use("/employees", employeeRoutes);
router.use("/clients", clientRoutes);
router.use("/projects", projectRoutes);
router.use("/services", serviceRoutes);
router.use("/notifications", notificationRoutes);
router.use("/files", fileRoutes);
router.use("/whatsapp", whatsappRoutes);
router.use("/analytics", analyticsRoutes);
router.use("/settings", settingsRoutes);

export default router;
