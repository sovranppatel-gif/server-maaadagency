import mongoose from "mongoose";

/**
 * Middleware to warn about MongoDB connection status on requests.
 * On Vercel, initial requests may arrive while connection is establishing.
 */
export function dbHealthMiddleware(_req, res, next) {
  const readyState = mongoose.connection.readyState;

  if (readyState === 1) {
    // Connected
    return next();
  }

  if (readyState === 2) {
    // Connecting - still okay, continue
    console.warn("[DB Health] Request received while MongoDB is still connecting (this is normal on cold start)");
    return next();
  }

  if (readyState === 0 || readyState === 3) {
    // Disconnected or disconnecting
    const stateName = readyState === 0 ? "DISCONNECTED" : "DISCONNECTING";
    console.error(`[DB Health] MongoDB ${stateName} - check Vercel logs for connection errors`);
    res.status(503).json({
      success: false,
      error: {
        message: "Database connection unavailable. Check Vercel logs for MongoDB errors.",
        status: "SERVICE_UNAVAILABLE",
        mongoReadyState: readyState,
      },
    });
    return;
  }

  next();
}
