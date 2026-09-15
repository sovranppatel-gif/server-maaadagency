import mongoose from "mongoose";
import { toJSONPlugin } from "./plugins.js";
import { FILE_CATEGORIES, FILE_TYPES } from "./common.js";

const fileAssetSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    storedName: String,
    url: { type: String, required: true },
    type: { type: String, enum: FILE_TYPES, default: "other", index: true },
    category: { type: String, enum: FILE_CATEGORIES, default: "Documents", index: true },
    size: { type: String, default: "0 KB" },
    bytes: { type: Number, default: 0 },
    mimeType: String,

    clientId: { type: mongoose.Schema.Types.ObjectId, ref: "Client" },
    clientName: String,
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project" },
    projectName: String,
    workId: { type: mongoose.Schema.Types.ObjectId, ref: "Work" },

    uploadedBy: { type: String, default: "Admin" },
    uploadedById: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    uploadedAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

fileAssetSchema.plugin(toJSONPlugin);
fileAssetSchema.index({ name: "text", clientName: "text", projectName: "text" });

export const FileAsset = mongoose.model("FileAsset", fileAssetSchema);
