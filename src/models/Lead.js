import mongoose from "mongoose";
import { toJSONPlugin, codePlugin } from "./plugins.js";
import { activitySchema, attachmentSchema, LEAD_SOURCES, LEAD_STATUSES, PRIORITIES } from "./common.js";

const leadSchema = new mongoose.Schema(
  {
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: "Client", required: true, index: true },
    clientName: { type: String, required: true }, // denormalised for list views
    phone: { type: String, required: true, index: true },
    company: String,
    email: String,

    service: { type: String, required: true, index: true },
    requirement: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    referenceWebsite: String,
    deadline: Date,
    budget: String,

    source: { type: String, enum: LEAD_SOURCES, default: "WhatsApp", index: true },
    priority: { type: String, enum: PRIORITIES, default: "MEDIUM", index: true },
    status: { type: String, enum: LEAD_STATUSES, default: "New", index: true },

    assignedEmployeeId: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", index: true },
    assignedDate: Date,
    conversationId: { type: mongoose.Schema.Types.ObjectId, ref: "Conversation" },

    attachments: { type: [attachmentSchema], default: [] },
    activity: { type: [activitySchema], default: [] },
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
