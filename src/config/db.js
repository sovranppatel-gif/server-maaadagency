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
  disconnectPromise: null,
  listenersAttached: false,
  lastError: null,
};

function attachConnectionListeners() {
  if (mongoCache.listenersAttached) return;
  mongoCache.listenersAttached = true;

  mongoose.connection.on("connected", () =>
    logger.info("MongoDB connected", { db: mongoose.connection.name })
  );
  mongoose.connection.on("error", (err) => {
    mongoCache.lastError = { message: err.message, code: err.code, name: err.name };
    logger.error("MongoDB error", { error: err.message, code: err.code, name: err.name });
  });
  mongoose.connection.on("disconnected", () => {
    // A fulfilled promise only represents the old connection. Clear it so the
    // next serverless invocation creates a fresh connection instead of using
    // stale state.
    mongoCache.connection = null;
    mongoCache.promise = null;
    logger.warn("MongoDB disconnected");
  });
}

function trackConnection(promise) {
  const tracked = promise
    .then(() => {
      mongoCache.connection = mongoose.connection;
      return mongoose.connection;
    })
    .catch((error) => {
      mongoCache.lastError = { message: error.message, code: error.code, name: error.name };
      if (mongoCache.promise === tracked) mongoCache.promise = null;
      mongoCache.connection = null;
      throw error;
    });
  mongoCache.promise = tracked;
  return tracked;
}

function beginConnection() {
  if (env.MONGODB_DNS_SERVERS.length > 0) dns.setServers(env.MONGODB_DNS_SERVERS);
  return trackConnection(
    mongoose.connect(env.MONGODB_URI, {
      serverSelectionTimeoutMS: 10_000,
      maxPoolSize: 20,
      autoIndex: !isProd, // build indexes in dev; manage explicitly in production
    })
  );
}

export async function connectDB() {
  attachConnectionListeners();

  switch (mongoose.connection.readyState) {
    case 1: // connected
      mongoCache.connection = mongoose.connection;
      return mongoose.connection;

    case 2: // connecting
      if (!mongoCache.promise) return trackConnection(mongoose.connection.asPromise());
      return mongoCache.promise;

    case 3: // disconnecting
      if (!mongoCache.disconnectPromise) {
        mongoCache.disconnectPromise = new Promise((resolve) => {
          mongoose.connection.once("disconnected", resolve);
        })
          .then(() => {
            mongoCache.disconnectPromise = null;
            return connectDB();
          })
          .catch((error) => {
            mongoCache.disconnectPromise = null;
            throw error;
          });
      }
      return mongoCache.disconnectPromise;

    default: // disconnected
      // Never return a fulfilled promise from a previous connection.
      if (mongoCache.disconnectPromise) return mongoCache.disconnectPromise;
      mongoCache.connection = null;
      mongoCache.promise = null;
      return beginConnection();
  }
}

export async function disconnectDB() {
  await mongoose.connection.close();
}

export function getMongoDBError() {
  return mongoCache.lastError;
}
