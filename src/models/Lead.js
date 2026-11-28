import mongoose from "mongoose";
import { toJSONPlugin, codePlugin } from "./plugins.js";
import { activitySchema, attachmentSchema, CALL_RESPONSES, LEAD_QUALITIES, LEAD_SOURCES, LEAD_STATUSES, PRIORITIES, ROLES } from "./common.js";

const historicalFollowUpSchema = new mongoose.Schema(
  {
    callDate: Date,
    rawDateLabel: { type: String, trim: true, maxlength: 80 },
    callResponse: { type: String, enum: [...CALL_RESPONSES, null], default: null },
    rawResponse: { type: String, trim: true, maxlength: 1000, default: "" },
    note: { type: String, trim: true, maxlength: 2000, default: "" },
    sourceSheet: { type: String, trim: true, maxlength: 120 },
    sourceRow: Number,
    importJobId: { type: mongoose.Schema.Types.ObjectId, ref: "ImportJob" },
    importedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);
historicalFollowUpSchema.plugin(toJSONPlugin);

const importMetadataSchema = new mongoose.Schema(
  {
    importJobId: { type: mongoose.Schema.Types.ObjectId, ref: "ImportJob" },
    sourceFileName: { type: String, trim: true, maxlength: 255 },
    sourceSheet: { type: String, trim: true, maxlength: 120 },
    sourceRow: Number,
    sourceSerial: { type: String, trim: true, maxlength: 60 },
    rawSource: { type: String, trim: true, maxlength: 200 },
    rawQuality: { type: String, trim: true, maxlength: 120 },
    rawAddress: { type: String, trim: true, maxlength: 500 },
    rawVisitNote: { type: String, trim: true, maxlength: 1000 },
    visitWarnings: { type: [String], default: [] },
    fingerprint: { type: String, index: true, sparse: true },
    importedAt: Date,
  },
  { _id: false }
);

const qualityHistorySchema = new mongoose.Schema(
  {
    fromQuality: { type: String, enum: [...LEAD_QUALITIES, null], default: null },
    toQuality: { type: String, enum: [...LEAD_QUALITIES, null], default: null },
    actor: { type: String, required: true },
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    actorRole: { type: String, enum: ROLES },
    reason: { type: String, trim: true, maxlength: 500 },
    timestamp: { type: Date, default: Date.now },
  },
  { _id: true }
);
qualityHistorySchema.plugin(toJSONPlugin);

const leadSchema = new mongoose.Schema(
  {
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: "Client", required: true, index: true },
    clientName: { type: String, required: true }, // denormalised for list views
    contactPersonName: { type: String, trim: true },
    phone: { type: String, required: true, index: true },
    alternatePhone: String,
    company: String,
    email: String,

    service: { type: String, required: true, index: true },
    requirement: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    quantitySizeDimensions: String,
    internalRemarks: String,
    referenceWebsite: String,
    deadline: Date,
    enquiryDate: Date,
    budget: String,

    source: { type: String, enum: LEAD_SOURCES, default: "WhatsApp", index: true },
    priority: { type: String, enum: PRIORITIES, default: "MEDIUM", index: true },
    quality: { type: String, enum: LEAD_QUALITIES, index: true },
    status: { type: String, enum: LEAD_STATUSES, default: "New", index: true },

    assignedEmployeeId: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", index: true },
    assignedDate: Date,
    followUpLimit: { type: Number, default: 4, min: 4 },
    followUpReviewRequired: { type: Boolean, default: false, index: true },
    followUpsClosed: { type: Boolean, default: false, index: true },
    followUpsClosedAt: Date,
    followUpsClosedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", select: false },
    conversationId: { type: mongoose.Schema.Types.ObjectId, ref: "Conversation" },
    submissionKey: { type: String, select: false, unique: true, sparse: true },

    attachments: { type: [attachmentSchema], default: [] },
    activity: { type: [activitySchema], default: [] },
    qualityHistory: { type: [qualityHistorySchema], default: [] },
    historicalFollowUps: { type: [historicalFollowUpSchema], default: [] },
    importMetadata: importMetadataSchema,
  },
  { timestamps: true }
);

leadSchema.plugin(toJSONPlugin);
leadSchema.plugin(codePlugin, { prefix: "LD", counter: "lead" });

leadSchema.index({ clientName: "text", requirement: "text", description: "text" });
leadSchema.index({ status: 1, createdAt: -1 });

/** Append an entry to the audit trail shown in the lead detail timeline. */
leadSchema.methods.log = function log(label, actor, description) {
  this.activity.push({ label, actor, description, timestamp: new Date() });
  return this;
};

export const Lead = mongoose.model("Lead", leadSchema);
