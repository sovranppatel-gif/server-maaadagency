import mongoose from "mongoose";
import { codePlugin, toJSONPlugin } from "./plugins.js";

const importErrorSchema = new mongoose.Schema(
  {
    sheet: { type: String, trim: true, maxlength: 120 },
    rowNumber: Number,
    code: { type: String, trim: true, maxlength: 60 },
    message: { type: String, required: true, trim: true, maxlength: 500 },
  },
  { _id: false }
);

const importJobSchema = new mongoose.Schema(
  {
    fileName: { type: String, required: true, trim: true, maxlength: 255 },
    fileFormat: { type: String, enum: ["xlsx", "csv"], required: true },
    fileSizeBytes: { type: Number, required: true, min: 0 },
    fileSha256: { type: String, required: true, index: true },
    worksheetNames: { type: [String], default: [] },
    selectedSheets: { type: [String], default: [] },
    importedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    importedByName: { type: String, required: true, trim: true },

    status: {
      type: String,
      enum: ["PREVIEW", "PROCESSING", "COMPLETED", "PARTIAL", "FAILED"],
      default: "PREVIEW",
      index: true,
    },
    importMode: {
      type: String,
      enum: ["CREATE_SKIP_DUPLICATES", "DRY_RUN"],
      default: "CREATE_SKIP_DUPLICATES",
    },

    previewTokenHash: { type: String, unique: true, sparse: true, select: false },
    previewExpiresAt: { type: Date, select: false },
    // Server-held parsed preview snapshot so confirmation never trusts client-edited rows.
    previewSnapshot: { type: mongoose.Schema.Types.Mixed, select: false },
    confirmIdempotencyKey: { type: String, unique: true, sparse: true, select: false },

    startedAt: Date,
    completedAt: Date,

    totalRows: { type: Number, default: 0, min: 0 },
    validRows: { type: Number, default: 0, min: 0 },
    createdCount: { type: Number, default: 0, min: 0 },
    duplicateCount: { type: Number, default: 0, min: 0 },
    skippedCount: { type: Number, default: 0, min: 0 },
    failedCount: { type: Number, default: 0, min: 0 },
    followUpHistoryCount: { type: Number, default: 0, min: 0 },
    visitHistoryCount: { type: Number, default: 0, min: 0 },
    visitWarningCount: { type: Number, default: 0, min: 0 },

    errorSummaries: { type: [importErrorSchema], default: [] },
    options: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

importJobSchema.plugin(toJSONPlugin);
importJobSchema.plugin(codePlugin, { prefix: "IMP", counter: "importJob", pad: 3 });

importJobSchema.index({ createdAt: -1 });

export const ImportJob = mongoose.model("ImportJob", importJobSchema);
