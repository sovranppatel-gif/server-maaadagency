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

  // Temporary diagnostic endpoint for WhatsApp env variable verification (BEFORE /api mount)
  app.get("/api/whatsapp/diagnostic", (_req, res) =>
    res.json({
      whatsappVerifyTokenExists: Boolean(env.whatsappVerifyToken),
      whatsappVerifyTokenLength: env.whatsappVerifyToken?.length || 0,
      whatsappPhoneNumberIdExists: Boolean(env.whatsappPhoneNumberId),
      whatsappAccessTokenExists: Boolean(env.whatsappAccessToken),
      whatsappAppSecretExists: Boolean(env.whatsappAppSecret),
      whatsappDryRun: env.whatsappDryRun,
    })
  );

  app.use("/api", apiLimiter, dbHealthMiddleware, routes);

  app.get("/api/vercel-test", (_req, res) =>
    res.json({
      success: true,
      message: "Vercel function routing is working"
    })
  );

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

// Create default instance for local development (src/server.js)
export default createApp();
