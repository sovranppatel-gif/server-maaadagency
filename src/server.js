import http from "node:http";
import app from "./app.js";
import { connectDB, disconnectDB } from "./config/db.js";
import { initSocket } from "./config/socket.js";
import { env } from "./config/env.js";
import { getConnectionStatus } from "./services/whatsapp.service.js";

const server = http.createServer(app);
initSocket(server);

function listen() {
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      if (err.code === "EADDRINUSE") {
        reject(new Error(`Port ${env.port} is already in use. Stop the other server process and try again.`));
        return;
      }
      reject(err);
    };

    server.once("error", onError);
    server.listen(env.port, () => {
      server.off("error", onError);
      console.log(`Server listening on http://localhost:${env.port}`);
      resolve();
    });
  });
}

async function shutdown(signal) {
  console.log(`Shutting down (${signal})...`);
  try {
    await new Promise((resolve) => {
      server.close(() => resolve());
      setTimeout(resolve, 800);
    });
    await disconnectDB();
  } catch {
    // ignore
  }
  process.exit(0);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

let mongoConnectionPromise = null;

async function connectMongoWithRetry() {
  if (mongoConnectionPromise) return mongoConnectionPromise;

  mongoConnectionPromise = (async () => {
    for (let attempt = 1; ; attempt++) {
      try {
        console.log(`[MongoDB] Connecting (attempt ${attempt})...`);
        await connectDB();
        console.log("✅ MongoDB connected successfully");
        return;
      } catch (err) {
        const retryDelay = Math.min(1000 * attempt, 5000);
        console.error(
          `❌ MongoDB connection failed (attempt ${attempt}):`,
          err?.message || err
        );

        if (attempt > 10) {
          console.error("\n⚠️ FAILED TO CONNECT AFTER 10 ATTEMPTS");
          console.error("❌ Check these:");
          console.error("   1. MONGO_URI environment variable is set in Vercel dashboard");
          console.error("   2. MongoDB Atlas IP whitelist includes 0.0.0.0/0 or Vercel IPs");
          console.error("   3. Credentials are correct: sovranppatel_db_user");
          throw err;
        }

        await new Promise((resolve) => setTimeout(resolve, retryDelay));
      }
    }
  })();

  return mongoConnectionPromise;
}

async function start() {
  console.log("Booting API...");

  await listen();

  try {
    await connectMongoWithRetry();
  } catch (err) {
    console.error("Fatal MongoDB error:", err?.message);
    console.error("⚠️ Server running but database unavailable. API calls will fail.");
  }

  const wa = getConnectionStatus();
  console.log(`WhatsApp: ${wa.connected ? "live" : "dry-run (no messages will be sent)"}`);
}

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
