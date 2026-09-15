import { createApp } from "./src/app.js";
import { connectDB } from "./src/config/db.js";

const app = createApp();
let databasePromise;

function ensureDatabase() {
  if (!databasePromise) {
    databasePromise = connectDB().catch((error) => {
      databasePromise = undefined;
      throw error;
    });
  }
  return databasePromise;
}

/** Vercel entrypoint. The local long-running server remains src/server.js. */
export default async function handler(req, res) {
  await ensureDatabase();
  return app(req, res);
}
