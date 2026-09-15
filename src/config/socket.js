import { Server } from "socket.io";
import { env } from "./env.js";
import { logger } from "./logger.js";
import { verifyAccessToken } from "../utils/jwt.js";

let io = null;

/**
 * Real-time channel for the Master Admin dashboard: new WhatsApp messages,
 * inbound leads and notifications are pushed instead of polled.
 */
export function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: env.CLIENT_ORIGIN.split(",").map((o) => o.trim()), credentials: true },
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(); // allow anonymous read-only sockets in development
    try {
      socket.user = verifyAccessToken(token);
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
