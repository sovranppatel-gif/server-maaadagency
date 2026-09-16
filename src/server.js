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

async function connectMongoWithRetry() {
  for (;;) {
    try {
      await connectDB();
      return;
    } catch (err) {
      console.error("MongoDB connect failed, retrying in 3s:", err?.message || err);
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
}

async function start() {
  console.log("Booting API...");

  await listen();
  await connectMongoWithRetry();

  const wa = getConnectionStatus();
  console.log(`WhatsApp: ${wa.connected ? "live" : "dry-run (no messages will be sent)"}`);
}

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
