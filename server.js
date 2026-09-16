import app from "./src/app.js";
import { connectDB } from "./src/config/db.js";

/** Vercel entrypoint. The local long-running server remains src/server.js. */
export default async function handler(req, res) {
  // connectDB caches a live pool, but checks Mongoose's state on every
  // invocation so a function reconnects after a transient serverless drop.
  await connectDB();
  return app(req, res);
}
