import { Notification } from "../models/Notification.js";
import { User } from "../models/User.js";
import { emitEvent } from "../config/socket.js";
import { logger } from "../config/logger.js";

/**
 * Single funnel for notifications: persists the record and pushes it to any
 * connected dashboard over the realtime channel.
 */
export async function notify({ title, description = "", category = "System", href, userId = null }) {
  try {
    const doc = await Notification.create({ title, description, category, href, userId });
    const payload = doc.toJSON();
    emitEvent("notification:new", payload, userId ? `user:${userId}` : undefined);
    return payload;
  } catch (err) {
    // A notification must never break the business operation that triggered it.
    logger.error("Failed to create notification", { error: err.message, title });
    return null;
  }
}

export const notifyWork = (title, description, href) => notify({ title, description, category: "Work", href });
export const notifyWhatsApp = (title, description, href) => notify({ title, description, category: "WhatsApp", href });
export const notifySystem = (title, description, href) => notify({ title, description, category: "System", href });

export async function notifyEmployee(employeeId, notification) {
  try {
    const user = await User.findOne({ employee: employeeId, role: "EMPLOYEE" }).select("_id").lean();
    if (!user) return null;
    return await notify({ ...notification, category: "Work", userId: user._id });
  } catch (err) {
    logger.error("Failed to resolve employee notification recipient", {
      employeeId: String(employeeId),
      error: err.message,
    });
    return null;
  }
}

export async function notifyOnce(dedupeKey, notification) {
  try {
    const doc = await Notification.create({ ...notification, dedupeKey });
    const payload = doc.toJSON();
    delete payload.dedupeKey;
    emitEvent("notification:new", payload, notification.userId ? `user:${notification.userId}` : undefined);
    return payload;
  } catch (err) {
    if (err?.code === 11000 && err.keyPattern?.dedupeKey) return null;
    logger.error("Failed to create deduplicated notification", {
      error: err.message,
      title: notification.title,
      dedupeKey,
    });
    return null;
  }
}

export async function notifyEmployeeOnce(employeeId, dedupeKey, notification) {
  try {
    const user = await User.findOne({ employee: employeeId, role: "EMPLOYEE" }).select("_id").lean();
    if (!user) return null;
    return await notifyOnce(dedupeKey, { ...notification, category: "Work", userId: user._id });
  } catch (err) {
    logger.error("Failed to resolve employee notification recipient", {
      employeeId: String(employeeId),
      error: err.message,
      dedupeKey,
    });
    return null;
  }
}
