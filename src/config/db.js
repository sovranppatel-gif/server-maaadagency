import dns from "node:dns";
import mongoose from "mongoose";
import { env, isProd } from "./env.js";
import { logger } from "./logger.js";

mongoose.set("strictQuery", true);
if (!isProd) mongoose.set("debug", false);

// Keep the pool across warm Vercel invocations. globalThis is intentional:
// module-local state can be recreated by serverless bundling while the process
// and its Mongoose connection remain alive.
const mongoCache = globalThis.__maaadagencyMongoCache ??= {
  connection: null,
  promise: null,
  listenersAttached: false,
};

function attachConnectionListeners() {
  if (mongoCache.listenersAttached) return;
  mongoCache.listenersAttached = true;

  mongoose.connection.on("connected", () =>
    logger.info("MongoDB connected", { db: mongoose.connection.name })
  );
  mongoose.connection.on("error", (err) => logger.error("MongoDB error", { error: err.message }));
  mongoose.connection.on("disconnected", () => logger.warn("MongoDB disconnected"));
}

export async function connectDB() {
  if (mongoose.connection.readyState === 1) {
    mongoCache.connection = mongoose.connection;
    return mongoose.connection;
  }
  if (mongoCache.promise) return mongoCache.promise;
  if (mongoose.connection.readyState === 2) {
    mongoCache.promise = mongoose.connection
      .asPromise()
      .then(() => {
        mongoCache.connection = mongoose.connection;
        return mongoose.connection;
      })
      .catch((error) => {
        mongoCache.promise = null;
        mongoCache.connection = null;
        throw error;
      });
    return mongoCache.promise;
  }

  if (env.MONGODB_DNS_SERVERS.length > 0) dns.setServers(env.MONGODB_DNS_SERVERS);
  attachConnectionListeners();

  mongoCache.promise = mongoose
    .connect(env.MONGODB_URI, {
      serverSelectionTimeoutMS: 10_000,
      maxPoolSize: 20,
      autoIndex: !isProd, // build indexes in dev; manage explicitly in production
    })
    .then(() => {
      mongoCache.connection = mongoose.connection;
      return mongoose.connection;
    })
    .catch((error) => {
      mongoCache.promise = null;
      mongoCache.connection = null;
      throw error;
    });

  return mongoCache.promise;
}

export async function disconnectDB() {
  await mongoose.connection.close();
}
