import mongoose from "mongoose";
import { toJSONPlugin } from "./plugins.js";

/**
 * Key/value store for non-secret operational settings.
 * Secrets (access tokens, verify tokens) intentionally never live here:
 * they are read from environment variables at runtime.
 */
const settingSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, index: true },
    value: { type: mongoose.Schema.Types.Mixed },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

settingSchema.plugin(toJSONPlugin);

settingSchema.statics.get = async function get(key, fallback = null) {
  const doc = await this.findOne({ key }).lean();
  return doc ? doc.value : fallback;
};

settingSchema.statics.put = async function put(key, value, updatedBy) {
  return this.findOneAndUpdate(
    { key },
    { value, updatedBy },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
};

export const Setting = mongoose.model("Setting", settingSchema);
