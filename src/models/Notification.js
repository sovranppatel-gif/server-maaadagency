import mongoose from "mongoose";
import { toJSONPlugin } from "./plugins.js";
import { NOTIFICATION_CATEGORIES } from "./common.js";

const notificationSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    description: { type: String, default: "" },
    category: { type: String, enum: NOTIFICATION_CATEGORIES, default: "System", index: true },
    read: { type: Boolean, default: false, index: true },
    href: String,
    // null audience means every admin sees it; otherwise it is user-scoped.
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    timestamp: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

notificationSchema.plugin(toJSONPlugin);
notificationSchema.index({ read: 1, timestamp: -1 });

export const Notification = mongoose.model("Notification", notificationSchema);
