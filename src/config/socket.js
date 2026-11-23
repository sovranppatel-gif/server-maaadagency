import { Server } from "socket.io";
import { env } from "./env.js";
import { logger } from "./logger.js";
import { verifyAccessToken } from "../utils/jwt.js";
import { User } from "../models/User.js";

let io = null;

/**
 * Real-time channel for the Master Admin dashboard: new WhatsApp messages,
 * inbound leads and notifications are pushed instead of polled.
 */
export function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: env.clientOrigin.split(",").map((o) => o.trim()), credentials: true },
  });

  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error("Authentication required"));
    try {
      const payload = verifyAccessToken(token);
      const user = await User.findById(payload.sub)
        .select("+tokenVersion")
        .populate("employee", "isActive");
      if (!user?.isActive || (payload.v ?? 0) !== user.tokenVersion) {
        return next(new Error("Session is no longer active"));
      }
      if (user.role === "EMPLOYEE" && (!user.employee || !user.employee.isActive)) {
        return next(new Error("Employee account is no longer active"));
      }
      if (user.role === "EMPLOYEE") return next(new Error("Employee sockets are not enabled"));
      socket.user = { sub: String(user._id), role: user.role };
    } catch {
      return next(new Error("Unauthorized socket connection"));
    }
    return next();
  });

  io.on("connection", (socket) => {
    logger.debug("Socket connected", { id: socket.id, user: socket.user?.sub ?? "anonymous" });
    if (socket.user?.role) socket.join(`role:${socket.user.role}`);
    if (socket.user?.sub) socket.join(`user:${socket.user.sub}`);
    socket.on("conversation:join", (conversationId) => socket.join(`conversation:${conversationId}`));
    socket.on("conversation:leave", (conversationId) => socket.leave(`conversation:${conversationId}`));
  });

  return io;
}

/** Safe emit: never let a realtime failure break an HTTP request. */
export function emitEvent(event, payload, room) {
  if (!io) return;
  try {
    (room ? io.to(room) : io).emit(event, payload);
  } catch (err) {
    logger.warn("Socket emit failed", { event, error: err.message });
  }
}
