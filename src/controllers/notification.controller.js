import { Notification } from "../models/Notification.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess } from "../utils/apiResponse.js";
import { buildMeta, getPagination } from "../utils/query.js";
import { q } from "../middleware/validate.js";

/** Notifications addressed to this user plus agency-wide broadcasts. */
function audienceFilter(req) {
  return { $or: [{ userId: null }, { userId: req.user?._id }] };
}

/** GET /api/notifications */
export const listNotifications = asyncHandler(async (req, res) => {
  const query = q(req);
  const { page, limit, skip } = getPagination(query, { defaultLimit: 30 });

  const filter = audienceFilter(req);
  if (query.category && query.category !== "All") filter.category = query.category;
  if (query.unreadOnly === "true") filter.read = false;

  const [items, total, unread] = await Promise.all([
    Notification.find(filter).sort({ timestamp: -1 }).skip(skip).limit(limit).lean(),
    Notification.countDocuments(filter),
    Notification.countDocuments({ ...audienceFilter(req), read: false }),
  ]);

  return sendSuccess(
    res,
    items.map((doc) => ({ ...doc, id: String(doc._id), _id: undefined })),
    { meta: { ...buildMeta({ page, limit, total }), unread } }
  );
});

/** GET /api/notifications/unread-count */
export const unreadCount = asyncHandler(async (req, res) => {
  const count = await Notification.countDocuments({ ...audienceFilter(req), read: false });
  return sendSuccess(res, { unread: count });
});

/** PATCH /api/notifications/:id/read */
export const markRead = asyncHandler(async (req, res) => {
  const notification = await Notification.findOneAndUpdate(
    { _id: req.params.id, ...audienceFilter(req) },
    { read: true },
    { new: true }
  );
  if (!notification) throw ApiError.notFound("Notification not found");
  return sendSuccess(res, notification.toJSON());
});

/** PATCH /api/notifications/read-all */
export const markAllRead = asyncHandler(async (req, res) => {
  const result = await Notification.updateMany({ ...audienceFilter(req), read: false }, { read: true });
  return sendSuccess(res, { updated: result.modifiedCount ?? 0 });
});

/** DELETE /api/notifications/:id */
export const deleteNotification = asyncHandler(async (req, res) => {
  const notification = await Notification.findOneAndDelete({ _id: req.params.id, ...audienceFilter(req) });
  if (!notification) throw ApiError.notFound("Notification not found");
  return sendSuccess(res, { id: String(notification._id), deleted: true });
});
