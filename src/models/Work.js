import mongoose from "mongoose";
import { toJSONPlugin, codePlugin } from "./plugins.js";
import {
  activitySchema,
  attachmentSchema,
  employeeReportSchema,
  revisionSchema,
  PRIORITIES,
  WORK_STATUSES,
} from "./common.js";

const workSchema = new mongoose.Schema(
  {
    leadId: { type: mongoose.Schema.Types.ObjectId, ref: "Lead", index: true },
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: "Client", required: true, index: true },
    clientName: { type: String, required: true },
    employeeId: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", index: true },
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project" },

    title: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    service: { type: String, required: true },
    priority: { type: String, enum: PRIORITIES, default: "MEDIUM", index: true },
    deadline: { type: Date, required: true },
    status: { type: String, enum: WORK_STATUSES, default: "UNASSIGNED", index: true },
    progress: { type: Number, default: 0, min: 0, max: 100 },

    attachments: { type: [attachmentSchema], default: [] },
    employeeReport: employeeReportSchema,
    revisionHistory: { type: [revisionSchema], default: [] },
    activity: { type: [activitySchema], default: [] },
  },
  { timestamps: true }
);

workSchema.plugin(toJSONPlugin);
workSchema.plugin(codePlugin, { prefix: "WK", counter: "work" });

workSchema.index({ title: "text", clientName: "text" });
workSchema.index({ status: 1, updatedAt: -1 });

workSchema.methods.log = function log(label, actor, description) {
  this.activity.push({ label, actor, description, timestamp: new Date() });
  return this;
};

/**
 * Allowed status transitions. The review workflow is enforced server-side
 * rather than trusting whatever status the client sends.
 */
export const WORK_TRANSITIONS = {
  UNASSIGNED: ["ASSIGNED"],
  ASSIGNED: ["IN_PROGRESS", "UNASSIGNED", "SUBMITTED"],
  IN_PROGRESS: ["SUBMITTED", "ASSIGNED"],
  SUBMITTED: ["APPROVED", "CHANGES_REQUESTED"],
  CHANGES_REQUESTED: ["IN_PROGRESS", "SUBMITTED"],
  APPROVED: ["COMPLETED", "CHANGES_REQUESTED"],
  COMPLETED: [],
};

export const Work = mongoose.model("Work", workSchema);
