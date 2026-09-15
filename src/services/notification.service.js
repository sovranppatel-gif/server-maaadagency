import { Notification } from "../models/Notification.js";
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
