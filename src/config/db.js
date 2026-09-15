import dns from "node:dns";
import mongoose from "mongoose";
import { env, isProd } from "./env.js";
import { logger } from "./logger.js";

mongoose.set("strictQuery", true);
if (!isProd) mongoose.set("debug", false);

export async function connectDB() {
  if (env.MONGODB_DNS_SERVERS.length > 0) dns.setServers(env.MONGODB_DNS_SERVERS);

  mongoose.connection.on("connected", () =>
    logger.info("MongoDB connected", { db: mongoose.connection.name })
  );
  mongoose.connection.on("error", (err) => logger.error("MongoDB error", { error: err.message }));
  mongoose.connection.on("disconnected", () => logger.warn("MongoDB disconnected"));

  await mongoose.connect(env.MONGODB_URI, {
    serverSelectionTimeoutMS: 10_000,
    maxPoolSize: 20,
    autoIndex: !isProd, // build indexes in dev; manage explicitly in production
  });

  return mongoose.connection;
}

export async function disconnectDB() {
  await mongoose.connection.close();
}
