import { Router } from "express";
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { getMongoDBError, connectDB } from "../config/db.js";

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

/** Temporary diagnostic endpoint for MongoDB connection errors (requires MONGODB_DIAGNOSTIC=true). */
router.get("/health/db-diagnostic", async (_req, res) => {
  if (env.MONGODB_DIAGNOSTIC !== "true") {
    return res.status(404).json({ success: false, error: { message: "Not found" } });
  }

  try {
    await connectDB();
    const dbState = DB_STATES[mongoose.connection.readyState] ?? "unknown";
    const healthy = dbState === "connected";

    return res.status(healthy ? 200 : 503).json({
      success: healthy,
      data: {
        status: healthy ? "ok" : "degraded",
        database: dbState,
        uptime: Math.round(process.uptime()),
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    return res.status(503).json({
      success: false,
      data: {
        status: "degraded",
        database: "disconnected",
        uptime: Math.round(process.uptime()),
        timestamp: new Date().toISOString(),
        connectionError: {
          message: err.message,
          code: err.code,
          type: err.name,
        },
      },
    });
  }
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
