import mongoose from "mongoose";
import { toJSONPlugin } from "./plugins.js";

export const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"];
export const LEAD_STATUSES = ["New", "Assigned", "In Progress", "Submitted", "Changes Requested", "Approved", "Completed"];
export const WORK_STATUSES = ["UNASSIGNED", "ASSIGNED", "IN_PROGRESS", "SUBMITTED", "CHANGES_REQUESTED", "APPROVED", "COMPLETED"];
export const LEAD_SOURCES = ["WhatsApp", "Website", "Manual", "Referral"];
export const AVAILABILITY = ["Available", "Busy", "On Leave"];
export const PROJECT_STATUSES = ["Planning", "Active", "Review", "Completed", "On Hold"];
export const CONVERSATION_STATUSES = ["New Leads", "Assigned", "Active", "Completed"];
export const FILE_TYPES = ["image", "pdf", "doc", "zip", "other"];
export const FILE_CATEGORIES = ["Client Files", "Employee Reports", "Project Files", "Screenshots", "Designs", "Documents"];
export const NOTIFICATION_CATEGORIES = ["Work", "WhatsApp", "System"];
export const ROLES = ["MASTER_ADMIN", "ADMIN", "EMPLOYEE"];

export const attachmentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    url: { type: String, required: true },
    type: { type: String, enum: FILE_TYPES, default: "other" },
    size: { type: String, default: "0 KB" },
    uploadedBy: { type: String, default: "Admin" },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);
attachmentSchema.plugin(toJSONPlugin);

export const activitySchema = new mongoose.Schema(
  {
    label: { type: String, required: true },
    description: String,
    actor: String,
    icon: String,
    timestamp: { type: Date, default: Date.now },
  },
  { _id: true }
);
activitySchema.plugin(toJSONPlugin);

export const revisionSchema = new mongoose.Schema(
  {
    notes: { type: String, required: true },
    priority: { type: String, enum: PRIORITIES, default: "MEDIUM" },
    deadline: Date,
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    requestedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);
revisionSchema.plugin(toJSONPlugin);

export const employeeReportSchema = new mongoose.Schema(
  {
    summary: { type: String, default: "" },
    files: { type: [attachmentSchema], default: [] },
    screenshots: { type: [attachmentSchema], default: [] },
    remarks: { type: String, default: "" },
    timeSpent: { type: String, default: "" },
    submittedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);
employeeReportSchema.plugin(toJSONPlugin);
