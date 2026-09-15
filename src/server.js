import http from "node:http";
import { createApp } from "./app.js";
import { connectDB, disconnectDB } from "./config/db.js";
import { initSocket } from "./config/socket.js";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { getConnectionStatus } from "./services/whatsapp.service.js";

async function bootstrap() {
  await connectDB();

  const app = createApp();
  const server = http.createServer(app);
  initSocket(server);

  server.listen(env.PORT, () => {
    const wa = getConnectionStatus();
    logger.info(`API listening on http://localhost:${env.PORT}`, { env: env.NODE_ENV });
    logger.info(`WhatsApp: ${wa.connected ? "live" : "dry-run (no messages will be sent)"}`);
  });

  /** Finish in-flight requests before exiting, then close the DB cleanly. */
  const shutdown = async (signal) => {
    logger.warn(`${signal} received, shutting down`);
    server.close(async () => {
      await disconnectDB();
      logger.info("Shutdown complete");
      process.exit(0);
    });
    // Do not hang forever if a connection refuses to drain.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  process.on("unhandledRejection", (reason) => {
    logger.error("Unhandled promise rejection", { reason: String(reason) });
  });
  process.on("uncaughtException", (err) => {
    logger.error("Uncaught exception", { error: err.message, stack: err.stack });
    process.exit(1);
  });
}

bootstrap().catch((err) => {
  logger.error("Failed to start server", { error: err.message, stack: err.stack });
  process.exit(1);
});
