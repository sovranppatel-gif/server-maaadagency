import path from "node:path";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import compression from "compression";
import cookieParser from "cookie-parser";
import morgan from "morgan";

import { env, isProd } from "./config/env.js";
import { logger } from "./config/logger.js";
import routes from "./routes/index.js";
import { errorHandler, notFound } from "./middleware/error.js";
import { sanitizeRequest } from "./middleware/sanitize.js";
import { apiLimiter } from "./middleware/rateLimit.js";
import { dbHealthMiddleware } from "./middleware/dbHealth.js";
import { connectDB } from "./config/db.js";

export function createApp() {
  const app = express();

  // Correct client IPs behind a reverse proxy (needed by the rate limiter).
  app.set("trust proxy", 1);
  app.disable("x-powered-by");

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: "cross-origin" }, // dashboard loads /uploads
    })
  );

  const allowedOrigins = env.clientOrigin.split(",").map((o) => o.trim());
  app.use(
    cors({
      origin(origin, callback) {
        // Same-origin/server-to-server requests arrive without an Origin header.
        if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
        return callback(new Error(`Origin ${origin} is not allowed by CORS`));
      },
      credentials: true,
    })
  );

  app.use(compression());
  app.use(cookieParser());

  app.use(
    express.json({
      limit: "1mb",
      // Meta signs the raw bytes: keep them for webhook signature verification.
      verify: (req, _res, buf) => {
        if (req.originalUrl.includes("/whatsapp/webhook")) req.rawBody = buf;
      },
    })
  );
  app.use(express.urlencoded({ extended: true, limit: "1mb" }));
  app.use(sanitizeRequest);

  app.use(
    morgan(isProd ? "combined" : "dev", {
      stream: { write: (msg) => logger.debug(msg.trim()) },
      skip: (req) => req.originalUrl === "/api/health",
    })
  );

  // Uploaded assets. Static, non-executable, served read-only.
  app.use(
    "/uploads",
    express.static(path.resolve(process.cwd(), env.uploadDir), {
      index: false,
      dotfiles: "deny",
      maxAge: "7d",
    })
  );

  app.use("/api", apiLimiter, dbHealthMiddleware, routes);

  app.get("/", (_req, res) =>
    res.json({
      success: true,
      data: { name: "Maa Ad Agency API", version: "1.0.0", docs: "/api/health" },
    })
  );

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

// Vercel can use this Express application directly as a serverless handler.
// The local entrypoint still calls createApp() and owns app.listen().
const app = createApp();

// Initialize MongoDB connection for both local and Vercel serverless environments
let mongoConnecting = false;
let mongoConnected = false;

async function initMongoDB() {
  if (mongoConnected || mongoConnecting) return;

  mongoConnecting = true;
  console.log("\n🔄 [App Init] Starting MongoDB connection...");

  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      await connectDB();
      mongoConnected = true;
      mongoConnecting = false;
      console.log("✅ [App Init] MongoDB connected successfully\n");
      return;
    } catch (err) {
      console.error(
        `⚠️ [App Init] Attempt ${attempt}/10 failed:`,
        err?.message || err
      );

      if (attempt < 10) {
        const delay = Math.min(1000 * attempt, 5000);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  mongoConnecting = false;
  console.error("\n❌ [App Init] Failed to connect MongoDB after 10 attempts\n");
}

// Start MongoDB connection attempt immediately when app loads
initMongoDB().catch((err) => {
  console.error("[App Init] MongoDB initialization error (non-fatal):", err?.message);
});

export default app;
